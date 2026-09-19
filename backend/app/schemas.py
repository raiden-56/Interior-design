from typing import Any

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = "Untitled Project"
    units: str = "meters"
    floorHeight: float = 3.0


class SceneUpdate(BaseModel):
    scene: dict[str, Any]


class ProjectUpsert(BaseModel):
    """Full project as the browser holds it. Sent on every autosave."""

    name: str = "Untitled Project"
    units: str = "meters"
    floorHeight: float = 3.0
    scene: dict[str, Any]
    updatedAt: int = Field(default=0, description="Client timestamp in ms")


class ProjectOut(BaseModel):
    id: str
    name: str
    units: str
    floorHeight: float
    scene: dict[str, Any] | None = None
    updatedAt: int = 0
    serverUpdatedAt: str | None = None


class AiPlanRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    project: dict[str, Any]
    activeFloorId: str


class AiPlanAction(BaseModel):
    id: str
    summary: str
    severity: str = "info"
    commands: list[dict[str, Any]]


class AiPlanResponse(BaseModel):
    actions: list[AiPlanAction]
    engine: str
    note: str | None = None
