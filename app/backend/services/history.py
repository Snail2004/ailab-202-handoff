import json
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import DATASET_FILES
from services.audit_log import log_event
from services.dataset_io import atomic_write_text, read_json, write_json_atomic


# Session-scale snapshot undo. This is intentionally simple for MVP and is not
# optimized for very long books; future work should move to diff-based history.
HISTORY_LIMIT = 25
MAX_HISTORY_BYTES = 5_000_000
HISTORY_VERSION = 1


class HistoryError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _history_path(project_path: Path) -> Path:
    return project_path / "working" / "history.json"


def _empty_history() -> dict[str, Any]:
    return {"version": HISTORY_VERSION, "undo": [], "redo": []}


def _read_history(project_path: Path) -> dict[str, Any]:
    path = _history_path(project_path)
    if not path.exists():
        return _empty_history()
    data = read_json(path)
    data.setdefault("version", HISTORY_VERSION)
    data.setdefault("undo", [])
    data.setdefault("redo", [])
    return data


def _write_history(project_path: Path, data: dict[str, Any]) -> None:
    data["undo"] = data.get("undo", [])[-HISTORY_LIMIT:]
    data["redo"] = data.get("redo", [])[-HISTORY_LIMIT:]
    _enforce_size_guard(data)
    write_json_atomic(_history_path(project_path), data)


def _history_size(data: dict[str, Any]) -> int:
    return len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _enforce_size_guard(data: dict[str, Any]) -> None:
    # Keep the newest history available, but avoid unbounded history.json growth.
    while _history_size(data) > MAX_HISTORY_BYTES:
        undo = data.get("undo", [])
        redo = data.get("redo", [])
        if len(undo) > 1:
            undo.pop(0)
            continue
        if len(redo) > 1:
            redo.pop(0)
            continue
        break


def _tracked_rel_paths() -> list[str]:
    rels = [f"canonical/{name}" for name in DATASET_FILES.values()]
    rels.extend([
        "working/review_state.json",
        "working/drafts.json",
    ])
    return rels


def _safe_project_file(project_path: Path, rel_path: str) -> Path:
    root = project_path.resolve()
    path = (project_path / rel_path).resolve()
    if root not in path.parents and path != root:
        raise HistoryError("invalid_history_path", f"History path escapes project root: {rel_path}", 500)
    return path


def snapshot_files(project_path: Path) -> dict[str, str | None]:
    snapshot: dict[str, str | None] = {}
    for rel in _tracked_rel_paths():
        path = _safe_project_file(project_path, rel)
        snapshot[rel] = path.read_text(encoding="utf-8") if path.exists() else None
    return snapshot


def _restore_files(project_path: Path, files: dict[str, str | None]) -> None:
    for rel, content in files.items():
        path = _safe_project_file(project_path, rel)
        if content is None:
            if path.exists():
                path.unlink()
            continue
        atomic_write_text(path, content)
    _regenerate_derived_files(project_path)


def _regenerate_derived_files(project_path: Path) -> None:
    # translation_review_log.csv is a read-only mirror generated from drafts.json.
    # It is not snapshotted, so restore must refresh it after undo/redo.
    if not (project_path / "working" / "drafts.json").exists():
        return
    try:
        from services.references import write_review_csv

        write_review_csv(project_path)
    except Exception as exc:
        log_event(project_path, "history_regenerate_csv_failed", {"message": str(exc)}, "system")


def _trim_event(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event.get("id"),
        "ts": event.get("ts"),
        "user": event.get("user"),
        "label": event.get("label"),
        "action": event.get("action"),
        "target": event.get("target", {}),
    }


def history_state(project_path: Path) -> dict[str, Any]:
    data = _read_history(project_path)
    undo = data.get("undo", [])
    redo = data.get("redo", [])
    recent = list(reversed(undo[-10:]))
    return {
        "can_undo": bool(undo),
        "can_redo": bool(redo),
        "undo_top": _trim_event(undo[-1]) if undo else None,
        "redo_top": _trim_event(redo[-1]) if redo else None,
        "recent": [_trim_event(event) for event in recent],
    }


def record_history(
    project_path: Path,
    *,
    action: str,
    label: str,
    target: dict[str, Any] | None,
    user: str,
    operation: Callable[[], Any],
) -> Any:
    before = snapshot_files(project_path)
    result = operation()
    after = snapshot_files(project_path)
    if before == after:
        return result

    data = _read_history(project_path)
    event = {
        "id": f"hist_{uuid.uuid4().hex[:12]}",
        "ts": _now_iso(),
        "user": user,
        "label": label,
        "action": action,
        "target": target or {},
        "before_files": before,
        "after_files": after,
    }
    data.setdefault("undo", []).append(event)
    data["redo"] = []
    _write_history(project_path, data)
    return result


def undo(project_path: Path, user: str = "local") -> dict[str, Any]:
    data = _read_history(project_path)
    undo_stack = data.get("undo", [])
    if not undo_stack:
        raise HistoryError("empty_undo_stack", "Nothing to undo.", 409)
    event = undo_stack.pop()
    _restore_files(project_path, event.get("before_files", {}))
    data.setdefault("redo", []).append(event)
    _write_history(project_path, data)
    log_event(project_path, "undo", {"history_id": event.get("id"), "label": event.get("label"), "target": event.get("target", {})}, user)
    return {"event": _trim_event(event), "history_state": history_state(project_path)}


def redo(project_path: Path, user: str = "local") -> dict[str, Any]:
    data = _read_history(project_path)
    redo_stack = data.get("redo", [])
    if not redo_stack:
        raise HistoryError("empty_redo_stack", "Nothing to redo.", 409)
    event = redo_stack.pop()
    _restore_files(project_path, event.get("after_files", {}))
    data.setdefault("undo", []).append(event)
    _write_history(project_path, data)
    log_event(project_path, "redo", {"history_id": event.get("id"), "label": event.get("label"), "target": event.get("target", {})}, user)
    return {"event": _trim_event(event), "history_state": history_state(project_path)}
