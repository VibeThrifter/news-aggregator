"""Persistent hnswlib vector index for event candidate retrieval."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence

import hnswlib
import numpy as np
from filelock import FileLock
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.repositories import EventCentroidSnapshot, EventRepository

logger = get_logger(__name__)


@dataclass(frozen=True)
class VectorCandidate:
    """Result of a nearest-neighbour lookup."""

    event_id: int
    similarity: float
    distance: float
    last_updated_at: datetime


class VectorIndexService:
    """Manage a persistent hnswlib index with recency-aware querying."""

    def __init__(
        self,
        *,
        dimension: Optional[int] = None,
        index_path: Optional[Path | str] = None,
        metadata_path: Optional[Path | str] = None,
    ) -> None:
        settings = get_settings()
        self.dimension = dimension or settings.embedding_dimension
        self.index_path = Path(index_path or settings.vector_index_path)
        self.metadata_path = Path(metadata_path or settings.vector_index_metadata_path)
        self.max_elements_default = settings.vector_index_max_elements
        self.m = settings.vector_index_m
        self.ef_construction = settings.vector_index_ef_construction
        self.ef_search = settings.vector_index_ef_search
        self.retention_days = settings.event_candidate_time_window_days
        self.default_top_k = settings.event_candidate_top_k

        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.metadata_path.parent.mkdir(parents=True, exist_ok=True)

        self._index: hnswlib.Index | None = None
        self._labels: set[int] = set()
        self._event_timestamps: Dict[int, datetime] = {}
        self._lock = asyncio.Lock()
        self._file_lock = FileLock(str(self.index_path) + ".lock")
        self._max_elements = self.max_elements_default

    async def ensure_ready(self, session: AsyncSession) -> None:
        """Load the index from disk or rebuild it if missing/corrupt."""

        async with self._lock:
            if self._index is not None:
                return

            if self.index_path.exists() and self.metadata_path.exists():
                try:
                    self._load_index()
                    await self._refresh_metadata(session)
                    logger.info(
                        "vector_index_loaded",
                        path=str(self.index_path),
                        label_count=len(self._labels),
                    )
                    return
                except Exception as exc:  # pragma: no cover - defensive logging
                    logger.warning(
                        "vector_index_load_failed",
                        error=str(exc),
                        action="rebuild",
                    )

            await self._rebuild_from_db(session)

    async def rebuild(self, session: AsyncSession) -> int:
        """Force a rebuild of the index from the database."""

        async with self._lock:
            return await self._rebuild_from_db(session)

    async def upsert(
        self,
        event_id: int,
        embedding: Sequence[float],
        last_updated_at: datetime,
        *,
        session: AsyncSession | None = None,
    ) -> None:
        """Insert or update an event centroid in the index."""

        if self._index is None:
            if session is None:
                raise RuntimeError(
                    "Vector index not initialised; call ensure_ready(session=...) before upserting"
                )
            await self.ensure_ready(session)

        async with self._lock:
            if self._index is None:
                raise RuntimeError("Vector index initialisation failed")

            vector = self._to_vector(embedding)
            if vector is None:
                logger.warning("vector_index_skip_upsert", event_id=event_id, reason="invalid_vector")
                return

            self._ensure_capacity(len(self._labels) + 1)

            replace_deleted = False
            if event_id in self._labels:
                self._index.mark_deleted(event_id)
                self._labels.remove(event_id)
                replace_deleted = True

            self._index.add_items(
                vector.reshape(1, -1),
                ids=[event_id],
                replace_deleted=replace_deleted,
            )
            self._labels.add(event_id)

            self._event_timestamps[event_id] = self._normalise_timestamp(last_updated_at)
            await self._persist_index()

    async def remove(self, event_id: int) -> None:
        """Mark an event as deleted within the index and persist state."""

        async with self._lock:
            if self._index is None or event_id not in self._labels:
                return

            self._index.mark_deleted(event_id)
            self._labels.remove(event_id)
            self._event_timestamps.pop(event_id, None)
            await self._persist_index()

    def get_indexed_event_ids(self) -> set[int]:
        """Return a copy of event identifiers currently present in the index."""

        return set(self._labels)

    async def query_candidates(
        self,
        embedding: Sequence[float],
        *,
        top_k: Optional[int] = None,
        now: Optional[datetime] = None,
    ) -> List[VectorCandidate]:
        """Query the nearest events filtered by the configured recency window."""

        if self._index is None:
            raise RuntimeError("Vector index not initialised; call ensure_ready() first")

        vector = self._to_vector(embedding)
        if vector is None or not self._labels:
            return []

        query_now = now or datetime.now(timezone.utc)
        cutoff = query_now - timedelta(days=self.retention_days)
        desired = top_k or self.default_top_k
        search_k = min(max(desired * 3, desired), len(self._labels))

        # hnswlib is CPU bound; execute call in executor to avoid blocking event loop.
        labels, distances = await asyncio.to_thread(
            self._index.knn_query,
            vector.reshape(1, -1),
            k=search_k or desired,
        )

        results: List[VectorCandidate] = []
        for label, distance in zip(labels[0], distances[0]):
            event_id = int(label)
            last_updated = self._event_timestamps.get(event_id)
            if last_updated is None or last_updated < cutoff:
                continue
            similarity = max(0.0, min(1.0, 1.0 - float(distance)))
            results.append(
                VectorCandidate(
                    event_id=event_id,
                    similarity=similarity,
                    distance=float(distance),
                    last_updated_at=last_updated,
                )
            )
            if len(results) >= desired:
                break
        return results

    async def _rebuild_from_db(self, session: AsyncSession) -> int:
        repo = EventRepository(session)
        snapshots = await repo.fetch_index_snapshots()
        vectors: List[np.ndarray] = []
        labels: List[int] = []
        timestamps: Dict[int, datetime] = {}

        for snapshot in snapshots:
            vector = self._to_vector(snapshot.centroid_embedding)
            if vector is None:
                logger.warning(
                    "vector_index_skip_snapshot",
                    event_id=snapshot.event_id,
                    reason="invalid_vector",
                )
                continue
            vectors.append(vector)
            labels.append(snapshot.event_id)
            timestamps[snapshot.event_id] = self._normalise_timestamp(snapshot.last_updated_at)

        index = self._create_index(max(self.max_elements_default, len(labels) + 256))

        if vectors:
            data = np.vstack(vectors)
            ids = np.asarray(labels, dtype=np.int64)
            index.add_items(data, ids)

        self._index = index
        self._labels = set(labels)
        self._event_timestamps = timestamps
        await self._persist_index()
        logger.info(
            "vector_index_rebuilt",
            label_count=len(self._labels),
        )
        return len(self._labels)

    async def _refresh_metadata(self, session: AsyncSession) -> None:
        if self._index is None:
            return
        repo = EventRepository(session)
        snapshots = await repo.fetch_index_snapshots()
        timestamps: Dict[int, datetime] = {}
        available_ids: set[int] = set()
        for snapshot in snapshots:
            if snapshot.event_id in self._labels:
                timestamps[snapshot.event_id] = self._normalise_timestamp(snapshot.last_updated_at)
                available_ids.add(snapshot.event_id)

        orphaned = self._labels - available_ids
        if orphaned:
            logger.warning(
                "vector_index_orphaned_labels",
                orphan_count=len(orphaned),
            )
            await self._rebuild_from_db(session)
            return

        self._event_timestamps = timestamps

    def _create_index(self, max_elements: int) -> hnswlib.Index:
        index = hnswlib.Index(space="cosine", dim=self.dimension)
        index.init_index(
            max_elements=max_elements,
            ef_construction=self.ef_construction,
            M=self.m,
            allow_replace_deleted=True,
        )
        index.set_ef(self.ef_search)
        self._max_elements = max_elements
        return index

    def _load_index(self) -> None:
        metadata = self._read_metadata()
        saved_dimension = metadata.get("dimension")
        if saved_dimension != self.dimension:
            raise ValueError(
                f"Vector index dimension mismatch (saved={saved_dimension}, expected={self.dimension})"
            )
        max_elements = int(metadata.get("max_elements", self.max_elements_default))
        index = hnswlib.Index(space="cosine", dim=self.dimension)
        index.load_index(str(self.index_path), max_elements=max_elements)
        index.set_ef(self.ef_search)
        self._index = index
        self._labels = set(int(label) for label in index.get_ids_list())
        self._max_elements = max_elements

    def _ensure_capacity(self, required: int) -> None:
        if self._index is None:
            return
        current_max = int(self._index.get_max_elements())
        if required <= current_max:
            return
        new_max = max(required, int(current_max * 1.5))
        self._index.resize_index(new_max)
        self._max_elements = new_max
        logger.info("vector_index_resized", new_max_elements=new_max)

    def _to_vector(self, embedding: Sequence[float]) -> np.ndarray | None:
        if not embedding:
            return None
        array = np.asarray(embedding, dtype=np.float32)
        if array.ndim != 1 or array.size != self.dimension:
            return None
        return array

    def _normalise_timestamp(self, value: datetime) -> datetime:
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    async def _persist_index(self) -> None:
        if self._index is None:
            return

        metadata = {
            "dimension": self.dimension,
            "max_elements": int(self._index.get_max_elements()),
            "m": self.m,
            "ef_construction": self.ef_construction,
            "ef_search": self.ef_search,
            "label_count": len(self._labels),
            "saved_at": datetime.now(timezone.utc).isoformat(),
        }

        def _write() -> None:
            with self._file_lock:
                self._index.save_index(str(self.index_path))
                with self.metadata_path.open("w", encoding="utf-8") as handle:
                    json.dump(metadata, handle, indent=2)

        await asyncio.to_thread(_write)

    def _read_metadata(self) -> Dict[str, object]:
        with self.metadata_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
