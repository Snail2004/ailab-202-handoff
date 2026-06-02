from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from config import DATASET_FILES, PIPELINE_VERSION, SCHEMA_VERSION
from services.audit_log import log_event
from services.dataset_io import read_json, write_json_atomic
from services.extraction import (
    _annotation_reasons,
    _reset_working_after_extract,
    default_metadata,
    now_iso,
    write_empty_sidecars,
    write_job,
)
from services.structure_normalizer import (
    StructurePlanError,
    apply_plan,
    build_candidate_parts,
    normalized_to_document,
    validate_plan,
)
from services.workspace import ProjectError, ensure_project_dirs, ensure_working_files, find_source_file


NORMALIZED_DIR = "normalized"
PROMPT_ID = "source-structure-normalizer-v1"


def _normalized_dir(project_path: Path) -> Path:
    path = project_path / "working" / NORMALIZED_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _candidate_path(project_path: Path) -> Path:
    return _normalized_dir(project_path) / "candidate_parts.json"


def _plan_path(project_path: Path) -> Path:
    return _normalized_dir(project_path) / "structure_plan.json"


def _normalized_document_path(project_path: Path) -> Path:
    return _normalized_dir(project_path) / "normalized_document.json"


def _normalization_report_path(project_path: Path) -> Path:
    return _normalized_dir(project_path) / "normalization_report.json"


def _source_for_project(project_path: Path) -> Path:
    source_path = find_source_file(project_path)
    if source_path is None:
        raise ProjectError("No TXT/EPUB source file found in raw/.")
    return source_path


def build_project_candidate_parts(project_path: Path, doc_id: str) -> dict[str, Any]:
    ensure_project_dirs(doc_id)
    ensure_working_files(project_path)
    source_path = _source_for_project(project_path)
    candidate = build_candidate_parts(source_path, doc_id=doc_id)
    write_json_atomic(_candidate_path(project_path), candidate)
    log_event(project_path, "normalize_candidate_parts", {
        "source_fingerprint": candidate.get("source_fingerprint"),
        "parts": len(candidate.get("parts", [])),
        "source_format": candidate.get("source_format"),
    }, "local")
    return candidate


def _load_or_build_candidate(project_path: Path, doc_id: str) -> dict[str, Any]:
    path = _candidate_path(project_path)
    if path.exists():
        return read_json(path)
    return build_project_candidate_parts(project_path, doc_id)


def _body_coverage(candidate: dict[str, Any], plan: dict[str, Any], normalized_document: dict[str, Any]) -> dict[str, Any]:
    dropped = {int(item["part_index"]) for item in plan.get("drop_parts", [])}
    headings = {int(item["part_index"]) for item in plan.get("chapter_headings", [])}
    body_expected = {
        int(part["index"])
        for part in candidate.get("parts", [])
        if int(part["index"]) not in dropped and int(part["index"]) not in headings
    }
    refs: list[int] = []
    for chapter in normalized_document.get("chapters", []):
        for block in chapter.get("blocks", []):
            refs.extend(int(index) for index in block.get("source_part_refs", []))
    body_refs = set(refs)
    return {
        "kept": len(body_refs),
        "expected": len(body_expected),
        "label": f"{len(body_refs)}/{len(body_expected)}",
        "missing_refs": sorted(body_expected - body_refs),
        "extra_refs": sorted(body_refs - body_expected),
        "duplicate_refs": len(refs) - len(body_refs),
    }


def _preview_payload(candidate: dict[str, Any], plan: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    normalized_document = result["normalized_document"]
    report = result["normalization_report"]
    coverage = _body_coverage(candidate, plan, normalized_document)
    return {
        "source_fingerprint": candidate.get("source_fingerprint"),
        "source_format": candidate.get("source_format"),
        "chapters": [
            {
                "order_index": chapter.get("order_index"),
                "title": chapter.get("title"),
                "n_blocks": len(chapter.get("blocks", [])),
            }
            for chapter in normalized_document.get("chapters", [])
        ],
        "dropped": [
            {
                "part_index": item.get("part_index"),
                "reason": item.get("reason"),
                "snippet": item.get("snippet"),
            }
            for item in report.get("dropped_parts", [])
        ],
        "drop_fraction": report.get("drop_fraction", 0.0),
        "low_confidence": bool(report.get("low_confidence")),
        "needs_human_check": bool(report.get("needs_human_check")),
        "flags": report.get("flags", []),
        "body_coverage": coverage["label"],
        "coverage": coverage,
        "content_invariance_ok": not coverage["missing_refs"] and not coverage["extra_refs"] and coverage["duplicate_refs"] == 0,
        "normalization_report": report,
    }


def import_structure_plan(project_path: Path, doc_id: str, plan: dict[str, Any]) -> dict[str, Any]:
    ensure_project_dirs(doc_id)
    ensure_working_files(project_path)
    candidate = _load_or_build_candidate(project_path, doc_id)
    validation = validate_plan(candidate, plan)
    if not validation["ok"]:
        return {
            "ok": False,
            "validation": validation,
            "source_fingerprint": candidate.get("source_fingerprint"),
        }

    output_dir = _normalized_dir(project_path)
    result = apply_plan(candidate, plan, output_dir)
    preview = _preview_payload(candidate, plan, result)
    log_event(project_path, "normalize_plan_import", {
        "source_fingerprint": candidate.get("source_fingerprint"),
        "chapters": len(preview["chapters"]),
        "low_confidence": preview["low_confidence"],
        "needs_human_check": preview["needs_human_check"],
    }, "local")
    return {
        "ok": True,
        "validation": validation,
        "preview": preview,
        "paths": {
            "candidate_parts": str(_candidate_path(project_path)),
            "structure_plan": str(_plan_path(project_path)),
            "normalized_document": str(_normalized_document_path(project_path)),
            "normalization_report": str(_normalization_report_path(project_path)),
        },
    }


def apply_normalized_document(
    project_path: Path,
    doc_id: str,
    approved: bool,
    overwrite: bool = False,
    force: bool = False,
    user: str = "local",
) -> dict[str, Any]:
    if not approved:
        raise ProjectError("Normalize apply requires approved=true.")
    ensure_project_dirs(doc_id)
    ensure_working_files(project_path)
    source_path = _source_for_project(project_path)
    normalized_path = _normalized_document_path(project_path)
    report_path = _normalization_report_path(project_path)
    if not normalized_path.exists() or not report_path.exists():
        raise ProjectError("No normalized preview exists. Import and validate a StructurePlan first.")

    dirs = ensure_project_dirs(doc_id)
    document_path = dirs["canonical"] / DATASET_FILES["document"]
    if document_path.exists() and not overwrite:
        raise ProjectError("Applying normalized structure can overwrite current document draft. Confirm overwrite first.")
    annotation_reasons = _annotation_reasons(project_path) if document_path.exists() else []
    if document_path.exists() and overwrite and annotation_reasons and not force:
        raise ProjectError(
            "annotations_present: normalized apply is blocked because existing annotation data depends on current block IDs "
            f"({', '.join(annotation_reasons)})."
        )

    normalized_document = read_json(normalized_path)
    report = read_json(report_path)
    metadata_report: dict[str, Any] = {}
    project_metadata = {}
    try:
        from services.extraction import load_project_metadata

        project_metadata = load_project_metadata(project_path)
    except Exception:
        project_metadata = {}
    metadata = default_metadata(doc_id, source_path, project_metadata, metadata_report)
    document = normalized_to_document(doc_id, metadata, normalized_document)

    job_id = f"normalize_extract_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    job = {
        "job_id": job_id,
        "type": "normalize_extract",
        "status": "running",
        "started_at": now_iso(),
        "finished_at": None,
        "message": "",
    }
    write_job(project_path, job)

    try:
        write_json_atomic(document_path, document)
        write_empty_sidecars(project_path, overwrite=bool(force and annotation_reasons))
        ensure_working_files(project_path, document)
        _reset_working_after_extract(project_path, document, reset_drafts=bool(force and annotation_reasons))

        report.setdefault("ai_provenance", {})
        report["ai_provenance"].update({
            "prompt_id": PROMPT_ID,
            "imported_by": user,
            "imported_at": now_iso(),
            "tool_called_llm": False,
        })
        report["dataset_schema_version"] = SCHEMA_VERSION
        report["pipeline_version"] = PIPELINE_VERSION
        report["applied_to_document"] = {
            "doc_id": doc_id,
            "chapters": len(document.get("chapters", [])),
            "blocks": sum(len(ch.get("blocks", [])) for ch in document.get("chapters", [])),
        }
        write_json_atomic(report_path, report)

        extraction_report = {
            "schema_version": "1.0",
            "dataset_schema_version": SCHEMA_VERSION,
            "pipeline_version": PIPELINE_VERSION,
            "source_file": source_path.name,
            "source_format": source_path.suffix.lower().lstrip(".") or "txt",
            "generated_at": now_iso(),
            "normalized_structure": True,
            "normalization_report": "working/normalized/normalization_report.json",
            "chapters": len(document.get("chapters", [])),
            "blocks": sum(len(ch.get("blocks", [])) for ch in document.get("chapters", [])),
        }
        if metadata_report.get("source_format_mismatch"):
            extraction_report["source_format_mismatch"] = metadata_report["source_format_mismatch"]
        write_json_atomic(project_path / "working" / "extraction_report.json", extraction_report)

        job.update({
            "status": "done",
            "finished_at": now_iso(),
            "message": f"Applied normalized structure: {extraction_report['blocks']} blocks in {extraction_report['chapters']} chapters",
            "document": {"chapters": extraction_report["chapters"], "blocks": extraction_report["blocks"]},
            "normalization_report": {
                "path": "working/normalized/normalization_report.json",
                "low_confidence": report.get("low_confidence"),
                "needs_human_check": report.get("needs_human_check"),
            },
        })
        write_job(project_path, job)
        log_event(project_path, "normalize_apply", {
            "job_id": job_id,
            "status": "done",
            "source_fingerprint": report.get("source_fingerprint"),
        }, user)
        return job
    except (ProjectError, StructurePlanError):
        job.update({"status": "failed", "finished_at": now_iso(), "message": "Normalize apply failed"})
        write_job(project_path, job)
        raise
    except Exception as exc:
        job.update({"status": "failed", "finished_at": now_iso(), "message": str(exc)})
        write_job(project_path, job)
        log_event(project_path, "normalize_apply", {"job_id": job_id, "status": "failed", "message": str(exc)}, user)
        raise
