import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import DATASET_FILES
from services.audit_log import log_event
from services.dataset_io import read_json, read_jsonl, write_json_atomic
from services.references import REFERENCE_STATUSES, draft_references
from services.validator import run_validator


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _canonical(project_path: Path) -> Path:
    return project_path / "canonical"


def _document(project_path: Path) -> dict[str, Any]:
    return read_json(_canonical(project_path) / DATASET_FILES["document"])


def _review_state(project_path: Path) -> dict[str, Any]:
    path = project_path / "working" / "review_state.json"
    if not path.exists():
        return {"blocks": {}}
    return read_json(path)


def _metadata_reasons(document: dict[str, Any]) -> list[str]:
    metadata = document.get("metadata", {})
    reasons = []
    for key in ("license", "contamination_risk", "pipeline_version", "source_format"):
        if not metadata.get(key):
            reasons.append(f"missing metadata.{key}")
    if metadata.get("extraction_tool") != "manual-synthetic" and not metadata.get("raw_sha256"):
        reasons.append("missing metadata.raw_sha256")
    return reasons


def freeze_reasons(project_path: Path) -> tuple[list[str], dict[str, Any]]:
    reasons: list[str] = []
    validation = run_validator(_canonical(project_path))
    if not validation.get("ok"):
        errors = validation.get("errors") or []
        reasons.append(f"{len(errors)} validation error(s)")

    document = _document(project_path)
    reasons.extend(_metadata_reasons(document))

    review = _review_state(project_path)
    block_states = review.get("blocks", {})
    all_blocks = [
        block.get("block_id")
        for chapter in document.get("chapters", [])
        for block in chapter.get("blocks", [])
        if block.get("block_id")
    ]
    unreviewed = [bid for bid in all_blocks if not block_states.get(bid, {}).get("reviewed")]
    needs_retag = [bid for bid in all_blocks if block_states.get(bid, {}).get("needs_retag")]
    if unreviewed:
        reasons.append(f"{len(unreviewed)} unreviewed block(s)")
    if needs_retag:
        reasons.append(f"{len(needs_retag)} block(s) need re-tag")

    drafts = draft_references(project_path)
    if drafts:
        reasons.append(f"{len(drafts)} draft reference(s)")

    references = read_jsonl(_canonical(project_path) / DATASET_FILES["manual_reference_subset"])
    if not references:
        reasons.append("no reviewed reference(s)")
    invalid_refs = [row.get("reference_id") for row in references if row.get("status") not in REFERENCE_STATUSES]
    if invalid_refs:
        reasons.append(f"{len(invalid_refs)} reference(s) with invalid status")

    summaries = read_jsonl(_canonical(project_path) / DATASET_FILES["chapter_summaries"])
    covered_chapters = {row.get("chapter_id") for row in summaries if row.get("summary_source") and row.get("source")}
    chapter_ids = {chapter.get("chapter_id") for chapter in document.get("chapters", []) if chapter.get("chapter_id")}
    missing_summaries = sorted(chapter_ids - covered_chapters)
    if missing_summaries:
        reasons.append(f"{len(missing_summaries)} chapter summary item(s) missing")

    return reasons, validation


def _next_freeze_version(project_path: Path) -> str:
    exports = project_path / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    used = set()
    for path in exports.glob("*_v*.zip"):
        stem = path.stem
        version = stem.rsplit("_", 1)[-1]
        used.add(version)
    index = 1
    while True:
        version = f"v{index:03d}"
        if version not in used:
            return version
        index += 1


def _write_zip(project_path: Path, zip_path: Path, include_working: bool, manifest: dict[str, Any]) -> None:
    manifest_path = zip_path.with_name(f"{zip_path.stem}_manifest.json")
    write_json_atomic(manifest_path, manifest)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_name in DATASET_FILES.values():
            path = _canonical(project_path) / file_name
            if path.exists():
                zf.write(path, f"canonical/{file_name}")
        if include_working:
            for path in (project_path / "working").glob("*"):
                if path.is_file():
                    zf.write(path, f"working/{path.name}")
        zf.write(manifest_path, manifest_path.name)


def export_project(project_path: Path, user: str = "local") -> dict[str, Any]:
    doc_id = project_path.name
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = project_path / "exports" / f"{doc_id}_export_{stamp}.zip"
    validation = run_validator(_canonical(project_path))
    manifest = {
        "doc_id": doc_id,
        "kind": "export",
        "created_at": _now_iso(),
        "validator_ok": bool(validation.get("ok")),
        "counts": validation.get("counts", {}),
        "files": list(DATASET_FILES.values()),
    }
    _write_zip(project_path, zip_path, include_working=True, manifest=manifest)
    log_event(project_path, "export", {"path": str(zip_path), "validator_ok": manifest["validator_ok"]}, user)
    return {"zip": str(zip_path), "manifest": str(zip_path.with_name(f"{zip_path.stem}_manifest.json")), "manifest_data": manifest}


def freeze_project(project_path: Path, user: str = "local") -> dict[str, Any]:
    reasons, validation = freeze_reasons(project_path)
    if reasons:
        return {"frozen": False, "reasons": reasons, "validation": validation}
    doc_id = project_path.name
    version = _next_freeze_version(project_path)
    zip_path = project_path / "exports" / f"{doc_id}_{version}.zip"
    manifest = {
        "doc_id": doc_id,
        "version": version,
        "kind": "freeze",
        "created_at": _now_iso(),
        "validator_ok": True,
        "counts": validation.get("counts", {}),
        "files": list(DATASET_FILES.values()),
    }
    _write_zip(project_path, zip_path, include_working=False, manifest=manifest)
    log_event(project_path, "freeze", {"version": version, "path": str(zip_path)}, user)
    return {"frozen": True, "version": version, "zip": str(zip_path), "manifest": str(zip_path.with_name(f"{zip_path.stem}_manifest.json")), "manifest_data": manifest}
