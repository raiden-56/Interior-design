import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Project
from ..schemas import ProjectCreate, ProjectOut, ProjectUpsert, SceneUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _out(p: Project) -> ProjectOut:
    return ProjectOut(
        id=p.id,
        name=p.name,
        units=p.units,
        floorHeight=p.floorHeight,
        scene=p.scene,
        updatedAt=p.client_updated_at or 0,
        serverUpdatedAt=p.updated_at.isoformat() if p.updated_at else None,
    )


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    """Full projects, scene included, so a browser can merge them into its local cache."""
    return [_out(p) for p in db.query(Project).order_by(Project.updated_at.desc()).all()]


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _out(project)


@router.put("/{project_id}", response_model=ProjectOut)
def upsert_project(project_id: str, payload: ProjectUpsert, db: Session = Depends(get_db)):
    """
    Idempotent save keyed on the client's own id. A stale write (older client
    timestamp than what is stored) is ignored rather than clobbering a newer
    save from another tab or device.
    """
    project = db.get(Project, project_id)
    if project is None:
        project = Project(id=project_id)
        db.add(project)
    elif payload.updatedAt and project.client_updated_at and payload.updatedAt < project.client_updated_at:
        return _out(project)

    project.name = payload.name
    project.units = payload.units
    project.floorHeight = payload.floorHeight
    project.scene = payload.scene
    project.client_updated_at = payload.updatedAt
    db.commit()
    db.refresh(project)
    return _out(project)


@router.delete("/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if project is None:
        # Deleting something already gone is a success from the caller's view.
        return {"ok": True, "id": project_id}
    db.delete(project)
    db.commit()
    return {"ok": True, "id": project_id}


# --- legacy endpoints kept so an older client build keeps working -----------


@router.post("", response_model=dict)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(id=uuid.uuid4().hex, name=payload.name, units=payload.units, floorHeight=payload.floorHeight)
    db.add(project)
    db.commit()
    return {"id": project.id}


@router.post("/{project_id}")
def upsert_scene(project_id: str, payload: SceneUpdate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if project is None:
        project = Project(id=project_id, name="Imported Project")
        db.add(project)
    project.scene = payload.scene
    db.commit()
    return {"ok": True, "id": project.id}
