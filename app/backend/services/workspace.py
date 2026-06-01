import re
import shutil
from pathlib import Path
from typing import Any

from config import DATASET_FILES, PROJECT_SUBDIRS, PROJECTS_ROOT, SAMPLE_ROOT
from services.dataset_io import default_review_state, read_json, write_json_atomic


PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


class ProjectError(ValueError):
    pass


def validate_doc_id(doc_id: str) -> str:
    if not PROJECT_ID_RE.match(doc_id):
        raise ProjectError("Invalid doc_id. Use letters, numbers, dot, dash, or underscore.")
    return doc_id


def get_project_path(doc_id: str) -> Path:
    validate_doc_id(doc_id)
    root = PROJECTS_ROOT.resolve()
    path = (root / doc_id).resolve()
    if root not in path.parents and path != root:
        raise ProjectError("Project path escapes the workspace root.")
    return path


def ensure_project_dirs(doc_id: str) -> dict[str, Path]:
    project_path = get_project_path(doc_id)
    dirs = {"project": project_path}
    for name in PROJECT_SUBDIRS:
        dirs[name] = project_path / name
        dirs[name].mkdir(parents=True, exist_ok=True)
    return dirs


def seed_project_from_sample(doc_id: str = "gold_demo_01") -> None:
    dirs = ensure_project_dirs(doc_id)
    canonical = dirs["canonical"]
    document_path = canonical / DATASET_FILES["document"]
    if document_path.exists():
        return

    sample_path = SAMPLE_ROOT / doc_id
    if not sample_path.is_dir():
        raise ProjectError(f"Seed sample not found: {sample_path}")

    for file_name in DATASET_FILES.values():
        source = sample_path / file_name
        if source.exists():
            shutil.copy2(source, canonical / file_name)

    document = read_json(document_path)
    review_path = dirs["working"] / "review_state.json"
    if not review_path.exists():
        write_json_atomic(review_path, default_review_state(document))


def ensure_seed_project() -> None:
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    seed_project_from_sample("gold_demo_01")


def has_project(doc_id: str) -> bool:
    return (get_project_path(doc_id) / "canonical" / DATASET_FILES["document"]).exists()


def list_projects() -> list[dict[str, Any]]:
    ensure_seed_project()
    projects: list[dict[str, Any]] = []
    if not PROJECTS_ROOT.exists():
        return projects

    for path in sorted(p for p in PROJECTS_ROOT.iterdir() if p.is_dir()):
        document_path = path / "canonical" / DATASET_FILES["document"]
        if not document_path.exists():
            continue
        try:
            document = read_json(document_path)
            metadata = document.get("metadata", {})
            title = metadata.get("title") or document.get("doc_id") or path.name
        except Exception:
            title = path.name
        projects.append({
            "doc_id": path.name,
            "title": title,
            "status": "available",
            "path": str(path.relative_to(PROJECTS_ROOT.parent)),
        })
    return projects


def project_file_state(doc_id: str) -> dict[str, Any]:
    project_path = get_project_path(doc_id)
    canonical = project_path / "canonical"
    return {
        "doc_id": doc_id,
        "path": str(project_path.relative_to(PROJECTS_ROOT.parent)),
        "has_raw": any((project_path / "raw").iterdir()) if (project_path / "raw").exists() else False,
        "has_canonical": canonical.exists(),
        "has_working": (project_path / "working").exists(),
        "files": {
            key: (canonical / file_name).exists()
            for key, file_name in DATASET_FILES.items()
        },
    }
