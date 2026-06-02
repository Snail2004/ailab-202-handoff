from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import DATASET_FILES
from services.audit_log import log_event
from services.dataset_io import (
    default_review_state,
    read_json,
    read_jsonl,
    write_json_atomic,
    write_jsonl_atomic,
)


class MutationError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


EDITABLE_METADATA = {
    "title",
    "author",
    "domain",
    "genre",
    "source_format",
    "license",
    "source_url",
    "contamination_risk",
}
EDITABLE_BLOCK = {"clean_text", "block_type", "is_chapter_opening", "quality_flags", "discourse"}
EDITABLE_GLOSSARY = {
    "source_term",
    "expected_target",
    "allowed_variants",
    "forbidden_variants",
    "status",
    "domain",
    "chapter_scope",
    "annotated_by",
    "confidence",
}
EDITABLE_ENTITY = {
    "canonical_source",
    "canonical_target",
    "aliases_source",
    "aliases_target",
    "pronoun_policy",
    "gender",
    "entity_type",
    "annotated_by",
    "confidence",
}
EDITABLE_SUMMARY = {
    "summary_source",
    "source",
    "characters_present",
    "key_events",
    "setting",
    "emotional_tone",
    "motifs",
    "summary_target",
    "open_threads",
    "translation_notes",
    "confidence",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _canonical(project_path: Path) -> Path:
    return project_path / "canonical"


def _document_path(project_path: Path) -> Path:
    return _canonical(project_path) / DATASET_FILES["document"]


def _jsonl_path(project_path: Path, key: str) -> Path:
    return _canonical(project_path) / DATASET_FILES[key]


def _read_document(project_path: Path) -> dict[str, Any]:
    return read_json(_document_path(project_path))


def _write_document(project_path: Path, document: dict[str, Any]) -> None:
    write_json_atomic(_document_path(project_path), document)


def _doc_id(document: dict[str, Any]) -> str:
    return str(document.get("doc_id") or "")


def _reject_unknown(payload: dict[str, Any], allowed: set[str]) -> None:
    unknown = sorted(set(payload) - allowed - {"user"})
    if unknown:
        raise MutationError("read_only_or_unknown_field", f"Field is not editable here: {unknown[0]}")


def _find_block(document: dict[str, Any], block_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    for chapter in document.get("chapters", []):
        for block in chapter.get("blocks", []):
            if block.get("block_id") == block_id:
                return chapter, block
    raise MutationError("missing_block", f"Block not found: {block_id}", 404)


def _block_ids(document: dict[str, Any]) -> set[str]:
    ids = set()
    for chapter in document.get("chapters", []):
        for block in chapter.get("blocks", []):
            if block.get("block_id"):
                ids.add(block["block_id"])
    return ids


def _chapter_ids(document: dict[str, Any]) -> set[str]:
    return {chapter["chapter_id"] for chapter in document.get("chapters", []) if chapter.get("chapter_id")}


def _next_id(rows: list[dict[str, Any]], field: str, prefix: str) -> str:
    used = {str(row.get(field)) for row in rows}
    index = 1
    while True:
        candidate = f"{prefix}_{index:03d}"
        if candidate not in used:
            return candidate
        index += 1


def _get_review_state(project_path: Path, document: dict[str, Any]) -> dict[str, Any]:
    path = project_path / "working" / "review_state.json"
    if path.exists():
        return read_json(path)
    return default_review_state(document)


def _write_review_state(project_path: Path, state: dict[str, Any]) -> None:
    write_json_atomic(project_path / "working" / "review_state.json", state)


def _mark_needs_retag(project_path: Path, document: dict[str, Any], block_id: str, value: bool = True) -> None:
    state = _get_review_state(project_path, document)
    state.setdefault("blocks", {}).setdefault(block_id, {})
    state["blocks"][block_id]["needs_retag"] = value
    _write_review_state(project_path, state)


def _normalize_span(payload: dict[str, Any]) -> list[int]:
    try:
        start = int(payload["start"])
        end = int(payload["end"])
    except (KeyError, TypeError, ValueError):
        raise MutationError("invalid_span", "Selection requires integer start and end.")
    if start < 0 or end <= start:
        raise MutationError("invalid_span", "Selection span must satisfy end > start >= 0.")
    return [start, end]


def _assert_span_matches(block: dict[str, Any], span: list[int], surface: str | None = None) -> str:
    text = block.get("clean_text") or ""
    start, end = span
    if end > len(text):
        raise MutationError("invalid_span", "Selection span is outside clean_text.")
    selected = text[start:end]
    if surface is not None and selected != surface:
        raise MutationError("selection_mismatch", "Selection span does not match the provided surface text.")
    return selected


def _stale_spans_for_block(project_path: Path, block: dict[str, Any]) -> list[dict[str, Any]]:
    block_id = block.get("block_id")
    text = block.get("clean_text") or ""
    stale: list[dict[str, Any]] = []

    for row in read_jsonl(_jsonl_path(project_path, "glossary")):
        for occ in row.get("occurrences", []):
            if occ.get("block_id") == block_id:
                span = occ.get("span") or []
                start, end = span if len(span) == 2 else (None, None)
                expected = row.get("source_term")
                actual = text[start:end] if isinstance(start, int) and isinstance(end, int) and end <= len(text) else None
                if actual != expected:
                    stale.append({"kind": "term", "id": row.get("term_id"), "expected_surface": expected, "span": span})

    for row in read_jsonl(_jsonl_path(project_path, "entities")):
        for mention in row.get("mentions", []):
            if mention.get("block_id") == block_id and mention.get("span"):
                span = mention.get("span") or []
                start, end = span if len(span) == 2 else (None, None)
                expected = mention.get("surface")
                actual = text[start:end] if isinstance(start, int) and isinstance(end, int) and end <= len(text) else None
                if actual != expected:
                    stale.append({"kind": "entity", "id": row.get("entity_id"), "expected_surface": expected, "span": span})

    return stale


def patch_metadata(project_path: Path, payload: dict[str, Any], user: str = "local") -> dict[str, Any]:
    _reject_unknown(payload, EDITABLE_METADATA)
    document = _read_document(project_path)
    metadata = document.setdefault("metadata", {})
    for key in EDITABLE_METADATA:
        if key in payload:
            metadata[key] = payload[key]
    _write_document(project_path, document)
    log_event(project_path, "patch_metadata", {"fields": sorted(set(payload) & EDITABLE_METADATA)}, user)
    return metadata


def patch_block(project_path: Path, block_id: str, payload: dict[str, Any], user: str = "local") -> dict[str, Any]:
    _reject_unknown(payload, EDITABLE_BLOCK)
    document = _read_document(project_path)
    _, block = _find_block(document, block_id)
    old_clean_text = block.get("clean_text")
    for key in EDITABLE_BLOCK:
        if key in payload:
            block[key] = payload[key]
    stale_spans: list[dict[str, Any]] = []
    if "clean_text" in payload and payload["clean_text"] != old_clean_text:
        stale_spans = _stale_spans_for_block(project_path, block)
        if stale_spans:
            _mark_needs_retag(project_path, document, block_id, True)
    _write_document(project_path, document)
    log_event(project_path, "patch_block", {"block_id": block_id, "fields": sorted(set(payload) & EDITABLE_BLOCK)}, user)
    return {"block": block, "stale_spans": stale_spans}


def patch_block_review(project_path: Path, block_id: str, payload: dict[str, Any], user: str = "local") -> dict[str, Any]:
    document = _read_document(project_path)
    _find_block(document, block_id)
    state = _get_review_state(project_path, document)
    reviewed = bool(payload.get("reviewed"))
    block_state = state.setdefault("blocks", {}).setdefault(block_id, {})
    block_state["reviewed"] = reviewed
    block_state["reviewed_by"] = payload.get("reviewed_by") if reviewed else None
    block_state["reviewed_at"] = _now_iso() if reviewed else None
    if "needs_retag" in payload:
        block_state["needs_retag"] = bool(payload["needs_retag"])
    _write_review_state(project_path, state)
    log_event(project_path, "patch_block_review", {"block_id": block_id, "reviewed": reviewed}, user)
    return block_state


def add_glossary_from_selection(project_path: Path, payload: dict[str, Any], user: str = "local") -> dict[str, Any]:
    document = _read_document(project_path)
    block_id = str(payload.get("block_id") or "")
    _, block = _find_block(document, block_id)
    span = _normalize_span(payload)
    source_term = payload.get("source_term") or _assert_span_matches(block, span)
    selected = _assert_span_matches(block, span, source_term)
    rows = read_jsonl(_jsonl_path(project_path, "glossary"))
    term_id = payload.get("term_id") or _next_id(rows, "term_id", "g")
    if any(row.get("term_id") == term_id for row in rows):
        raise MutationError("duplicate_term", f"term_id already exists: {term_id}")

    row = {
        "term_id": term_id,
        "doc_id": _doc_id(document),
        "source_term": selected,
        "expected_target": payload.get("expected_target") or selected,
        "allowed_variants": payload.get("allowed_variants", []),
        "forbidden_variants": payload.get("forbidden_variants", []),
        "domain": payload.get("domain", document.get("metadata", {}).get("domain", "")),
        "chapter_scope": payload.get("chapter_scope", "global"),
        "status": payload.get("status", "candidate"),
        "occurrences": [{"block_id": block_id, "span": span}],
        "annotated_by": payload.get("annotated_by", user),
        "confidence": payload.get("confidence", 1.0),
    }
    rows.append(row)
    write_jsonl_atomic(_jsonl_path(project_path, "glossary"), rows)
    ann = block.setdefault("annotations", {})
    refs = ann.setdefault("term_occurrences", [])
    if term_id not in refs:
        refs.append(term_id)
    _write_document(project_path, document)
    log_event(project_path, "add_glossary_from_selection", {"term_id": term_id, "block_id": block_id}, user)
    return row


def patch_glossary(project_path: Path, term_id: str, payload: dict[str, Any], user: str = "local") -> dict[str, Any]:
    _reject_unknown(payload, EDITABLE_GLOSSARY)
    rows = read_jsonl(_jsonl_path(project_path, "glossary"))
    for row in rows:
        if row.get("term_id") == term_id:
            for key in EDITABLE_GLOSSARY:
                if key in payload:
                    row[key] = payload[key]
            write_jsonl_atomic(_jsonl_path(project_path, "glossary"), rows)
            log_event(project_path, "patch_glossary", {"term_id": term_id, "fields": sorted(set(payload) & EDITABLE_GLOSSARY)}, user)
            return row
    raise MutationError("missing_term", f"Term not found: {term_id}", 404)


def delete_glossary(project_path: Path, term_id: str, user: str = "local") -> dict[str, Any]:
    document = _read_document(project_path)
    rows = read_jsonl(_jsonl_path(project_path, "glossary"))
    target = next((row for row in rows if row.get("term_id") == term_id), None)
    if target is None:
        raise MutationError("missing_term", f"Term not found: {term_id}", 404)
    if target.get("status") == "locked":
        raise MutationError("locked_term", "Locked terms cannot be deleted.")
    for chapter in document.get("chapters", []):
        for block in chapter.get("blocks", []):
            refs = (block.get("annotations") or {}).get("term_occurrences", [])
            if term_id in refs:
                raise MutationError("term_still_referenced", "Term is still referenced by a block.")
    if target.get("occurrences"):
        raise MutationError("term_has_occurrences", "Term still has occurrences.")
    kept = [row for row in rows if row.get("term_id") != term_id]
    write_jsonl_atomic(_jsonl_path(project_path, "glossary"), kept)
    log_event(project_path, "delete_glossary", {"term_id": term_id}, user)
    return {"term_id": term_id, "deleted": True}


def add_entity_from_selection(project_path: Path, payload: dict[str, Any], user: str = "local") -> dict[str, Any]:
    document = _read_document(project_path)
    block_id = str(payload.get("block_id") or "")
    _, block = _find_block(document, block_id)
    span = _normalize_span(payload)
    surface = payload.get("surface") or _assert_span_matches(block, span)
    selected = _assert_span_matches(block, span, surface)
    rows = read_jsonl(_jsonl_path(project_path, "entities"))

    entity_id = payload.get("entity_id")
    if entity_id:
        row = next((item for item in rows if item.get("entity_id") == entity_id), None)
        if row is None:
            raise MutationError("missing_entity", f"Entity not found: {entity_id}", 404)
        row.setdefault("mentions", []).append({"block_id": block_id, "surface": selected, "span": span})
    else:
        entity_id = _next_id(rows, "entity_id", "e")
        row = {
            "entity_id": entity_id,
            "doc_id": _doc_id(document),
            "canonical_source": payload.get("canonical_source") or selected,
            "canonical_target": payload.get("canonical_target") or selected,
            "entity_type": payload.get("entity_type", "concept"),
            "gender": payload.get("gender", None),
            "aliases_source": payload.get("aliases_source", []),
            "aliases_target": payload.get("aliases_target", []),
            "pronoun_policy": payload.get("pronoun_policy", ""),
            "mentions": [{"block_id": block_id, "surface": selected, "span": span}],
            "annotated_by": payload.get("annotated_by", user),
            "confidence": payload.get("confidence", 1.0),
        }
        rows.append(row)

    write_jsonl_atomic(_jsonl_path(project_path, "entities"), rows)
    ann = block.setdefault("annotations", {})
    refs = ann.setdefault("entity_mentions", [])
    if entity_id not in refs:
        refs.append(entity_id)
    _write_document(project_path, document)
    log_event(project_path, "add_entity_from_selection", {"entity_id": entity_id, "block_id": block_id}, user)
    return row


def patch_entity(project_path: Path, entity_id: str, payload: dict[str, Any], user: str = "local") -> dict[str, Any]:
    _reject_unknown(payload, EDITABLE_ENTITY)
    rows = read_jsonl(_jsonl_path(project_path, "entities"))
    for row in rows:
        if row.get("entity_id") == entity_id:
            for key in EDITABLE_ENTITY:
                if key in payload:
                    row[key] = payload[key]
            write_jsonl_atomic(_jsonl_path(project_path, "entities"), rows)
            log_event(project_path, "patch_entity", {"entity_id": entity_id, "fields": sorted(set(payload) & EDITABLE_ENTITY)}, user)
            return row
    raise MutationError("missing_entity", f"Entity not found: {entity_id}", 404)


def delete_entity(project_path: Path, entity_id: str, user: str = "local") -> dict[str, Any]:
    document = _read_document(project_path)
    rows = read_jsonl(_jsonl_path(project_path, "entities"))
    target = next((row for row in rows if row.get("entity_id") == entity_id), None)
    if target is None:
        raise MutationError("missing_entity", f"Entity not found: {entity_id}", 404)
    if target.get("mentions"):
        raise MutationError("entity_has_mentions", "Entity still has mentions.")

    for chapter in document.get("chapters", []):
        for block in chapter.get("blocks", []):
            annotations = block.get("annotations") or {}
            if entity_id in annotations.get("entity_mentions", []):
                raise MutationError("entity_still_referenced", "Entity is still referenced by a block.")
            discourse = block.get("discourse") or {}
            if entity_id in (discourse.get("speaker_entity_id"), discourse.get("addressee_entity_id")):
                raise MutationError("entity_still_referenced", "Entity is still referenced by block discourse.")

    summaries = read_jsonl(_jsonl_path(project_path, "chapter_summaries"))
    for row in summaries:
        if entity_id in row.get("characters_present", []):
            raise MutationError("entity_still_referenced", "Entity is still referenced by a chapter summary.")

    kept = [row for row in rows if row.get("entity_id") != entity_id]
    write_jsonl_atomic(_jsonl_path(project_path, "entities"), kept)
    log_event(project_path, "delete_entity", {"entity_id": entity_id}, user)
    return {"entity_id": entity_id, "deleted": True}


def patch_summary(project_path: Path, chapter_id: str, payload: dict[str, Any], user: str = "local") -> dict[str, Any]:
    _reject_unknown(payload, EDITABLE_SUMMARY)
    document = _read_document(project_path)
    if chapter_id not in _chapter_ids(document):
        raise MutationError("missing_chapter", f"Chapter not found: {chapter_id}", 404)
    rows = read_jsonl(_jsonl_path(project_path, "chapter_summaries"))
    row = next((item for item in rows if item.get("chapter_id") == chapter_id), None)
    if row is None:
        row = {
            "doc_id": _doc_id(document),
            "chapter_id": chapter_id,
            "summary_source": payload.get("summary_source", "Draft summary"),
            "source": payload.get("source", "human"),
        }
        rows.append(row)
    for key in EDITABLE_SUMMARY:
        if key in payload:
            row[key] = payload[key]
    write_jsonl_atomic(_jsonl_path(project_path, "chapter_summaries"), rows)
    log_event(project_path, "patch_summary", {"chapter_id": chapter_id, "fields": sorted(set(payload) & EDITABLE_SUMMARY)}, user)
    return row


def snapshot_project(project_path: Path) -> dict[str, Any]:
    return deepcopy({
        "document": read_json(_document_path(project_path)),
        "glossary": read_jsonl(_jsonl_path(project_path, "glossary")),
        "entities": read_jsonl(_jsonl_path(project_path, "entities")),
        "summaries": read_jsonl(_jsonl_path(project_path, "chapter_summaries")),
        "references": read_jsonl(_jsonl_path(project_path, "manual_reference_subset")),
    })
