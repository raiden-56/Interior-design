from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Project(Base):
    """
    One row per design project. The primary key is the *client-generated* id
    (`project-xxxxxxxx`), so the browser can upsert the same project on every
    autosave instead of minting a new server id each time -- which is what
    the original create-then-post flow did, leaving a duplicate row per save.
    """

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), default="Untitled Project")
    units: Mapped[str] = mapped_column(String(16), default="meters")
    floorHeight: Mapped[float] = mapped_column(Float, default=3.0)
    scene: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Client clock, in ms. Lets a browser decide "newer wins" when merging its
    # local copy with the server copy without trusting two different clocks.
    client_updated_at: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(), default=now_utc, onupdate=now_utc)
