"""
AI planning endpoint.

The browser already ships a deterministic, rule-based planner (`lib/ai.ts`)
that works with no server at all. This endpoint upgrades it: when an
`ANTHROPIC_API_KEY` is configured, the prompt and a compact description of the
floor are sent to Claude, which must answer with the *same* structured command
list the rule engine produces. The client previews and confirms before
applying, exactly as before -- the model never mutates anything directly.

Without a key the endpoint answers 503 and the client silently keeps using the
local rules, so the feature is strictly additive.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from fastapi import APIRouter, HTTPException

from ..schemas import AiPlanAction, AiPlanRequest, AiPlanResponse

router = APIRouter(prefix="/ai", tags=["ai"])

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-5")

ALLOWED_TYPES = {
    "ADD_WALL", "UPDATE_WALL", "DELETE_WALL",
    "ADD_DOOR", "UPDATE_DOOR", "DELETE_DOOR",
    "ADD_WINDOW", "UPDATE_WINDOW", "DELETE_WINDOW",
    "ADD_ROOM", "UPDATE_ROOM", "DELETE_ROOM",
    "ADD_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT",
}

SYSTEM = """You are the planning engine inside an interior-design editor.
You receive a floor plan (metres; x = east, y/z = north; rotation in radians around the vertical axis)
and a request from the designer. Reply with JSON ONLY, no prose, matching this schema:

{"actions":[{"summary":"short human sentence","severity":"info"|"warning",
  "commands":[{"label":"short label","command":{...}}]}]}

Each `command` is one of:
- {"type":"ADD_OBJECT","object":{"id":"obj-<6 random chars>","assetId":<from catalog>,"name":<catalog name>,"shape":<catalog shape>,"x":n,"z":n,"rotation":n,"scale":1,"width":n,"depth":n,"height":n,"color":"#rrggbb"|null,"materialId":null}}
- {"type":"UPDATE_OBJECT","id":<existing id>,"patch":{"x"?,"z"?,"rotation"?,"color"?,"materialId"?,"scale"?}}
- {"type":"DELETE_OBJECT","id":<existing id>}
- {"type":"UPDATE_WALL","id":<existing id>,"patch":{"color"?:"#rrggbb","materialId"?:<material id>}}
- {"type":"UPDATE_ROOM","id":<existing id>,"patch":{"color"?,"materialId"?,"name"?}}

Rules: only reference ids that exist in the plan; place furniture inside room polygons and away from
walls (>=0.3 m clearance); use catalog dimensions verbatim; keep colours as hex; never invent command
types; if the request cannot be fulfilled return {"actions":[]}."""


def _compact_floor(project: dict[str, Any], floor_id: str) -> dict[str, Any]:
    floors = project.get("floors") or []
    floor = next((f for f in floors if f.get("id") == floor_id), floors[0] if floors else {})
    return {
        "units": project.get("units", "meters"),
        "walls": [
            {"id": w["id"], "a": w["a"], "b": w["b"], "height": w.get("height"), "color": w.get("color")}
            for w in floor.get("walls", [])
        ],
        "doors": [{"id": d["id"], "wallId": d["wallId"], "offset": d["offset"], "width": d["width"]} for d in floor.get("doors", [])],
        "windows": [{"id": w["id"], "wallId": w["wallId"], "offset": w["offset"], "width": w["width"]} for w in floor.get("windows", [])],
        "rooms": [{"id": r["id"], "name": r.get("name"), "points": r["points"]} for r in floor.get("rooms", [])],
        "objects": [
            {
                "id": o["id"], "name": o.get("name"), "shape": o.get("shape"), "x": o["x"], "z": o["z"],
                "rotation": o.get("rotation", 0), "width": o.get("width"), "depth": o.get("depth"), "color": o.get("color"),
            }
            for o in floor.get("objects", [])
        ],
    }


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    # Tolerate a fenced block or leading prose despite the instruction.
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    else:
        start = text.find("{")
        if start > 0:
            text = text[start:]
    return json.loads(text)


def _sanitise(raw: dict[str, Any], plan: dict[str, Any]) -> list[AiPlanAction]:
    """Drop anything the model made up: unknown command types or ids."""
    known_ids: set[str] = set()
    for key in ("walls", "doors", "windows", "rooms", "objects"):
        known_ids.update(item["id"] for item in plan.get(key, []))

    out: list[AiPlanAction] = []
    for i, action in enumerate(raw.get("actions") or []):
        cmds: list[dict[str, Any]] = []
        for c in action.get("commands") or []:
            cmd = c.get("command") if isinstance(c, dict) else None
            if not isinstance(cmd, dict) or cmd.get("type") not in ALLOWED_TYPES:
                continue
            if cmd["type"].startswith(("UPDATE_", "DELETE_")) and cmd.get("id") not in known_ids:
                continue
            if cmd["type"] == "ADD_OBJECT":
                obj = cmd.get("object") or {}
                required = {"id", "assetId", "name", "shape", "x", "z", "width", "depth", "height"}
                if not required.issubset(obj):
                    continue
                obj.setdefault("rotation", 0)
                obj.setdefault("scale", 1)
                obj.setdefault("color", None)
                obj.setdefault("materialId", None)
            cmds.append({"label": str(c.get("label") or cmd["type"].replace("_", " ").title()), "command": cmd})
        if cmds:
            out.append(
                AiPlanAction(
                    id=f"ai-{i + 1}",
                    summary=str(action.get("summary") or "Proposed change"),
                    severity="warning" if action.get("severity") == "warning" else "info",
                    commands=cmds,
                )
            )
    return out


@router.get("/status")
def status():
    return {"enabled": bool(os.getenv("ANTHROPIC_API_KEY")), "model": MODEL}


@router.post("/plan", response_model=AiPlanResponse)
def plan(req: AiPlanRequest):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI planning is not configured (set ANTHROPIC_API_KEY)")

    try:
        import anthropic  # imported lazily so the server runs without the package
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(status_code=503, detail="anthropic package not installed") from exc

    compact = _compact_floor(req.project, req.activeFloorId)
    catalog = req.project.get("_catalog")  # the client attaches the furniture catalog summary

    user = json.dumps({"request": req.prompt, "floor": compact, "catalog": catalog}, separators=(",", ":"))

    client = anthropic.Anthropic(api_key=api_key)
    try:
        message = client.messages.create(
            model=MODEL,
            max_tokens=8000,
            # Adaptive thinking lets the model reason about placement geometry;
            # medium effort keeps a small layout request fast and cheap.
            thinking={"type": "adaptive"},
            output_config={"effort": "medium"},
            system=SYSTEM,
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.RateLimitError as exc:
        raise HTTPException(status_code=429, detail="AI provider is rate limiting; try again shortly") from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=502, detail=f"AI provider error ({exc.status_code})") from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(status_code=502, detail="Could not reach the AI provider") from exc

    if message.stop_reason == "refusal":
        return AiPlanResponse(actions=[], engine=MODEL, note="The request was declined by the model's safety policy.")
    if message.stop_reason == "max_tokens":
        return AiPlanResponse(actions=[], engine=MODEL, note="The plan was too long to return; try a smaller request.")

    text = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
    try:
        raw = _extract_json(text)
    except (ValueError, json.JSONDecodeError):
        return AiPlanResponse(actions=[], engine=MODEL, note="The model returned an unreadable answer; try rephrasing.")

    return AiPlanResponse(actions=_sanitise(raw, compact), engine=MODEL)
