from copy import deepcopy
from datetime import datetime, timezone
from difflib import SequenceMatcher
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
    def __init__(self, code: str, message: str, status: int = 400, **details: Any):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details


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


def _reanchor_span(
    old_text: str,
    new_text: str,
    span: Any,
    expected: Any,
    opcodes: list[tuple[str, int, int, int, int]],
) -> list[int] | None:
    if not isinstance(expected, str) or not expected:
        return None
    if not isinstance(span, list) or len(span) != 2:
        return None
    start, end = span
    if not isinstance(start, int) or not isinstance(end, int):
        return None
    if not (0 <= start < end <= len(old_text)):
        return None
    if old_text[start:end] != expected:
        return None

    for tag, i1, i2, j1, _j2 in opcodes:
        if tag == "equal" and i1 <= start and end <= i2:
            new_start = j1 + (start - i1)
            new_end = j1 + (end - i1)
            if new_text[new_start:new_end] == expected:
                return [new_start, new_end]
            return None
    return None


def _reanchor_or_stale_spans_for_block(
    project_path: Path,
    block_id: str,
    old_text: str,
    new_text: str,
) -> tuple[list[dict[str, Any]], int]:
    opcodes = SequenceMatcher(None, old_text, new_text, autojunk=False).get_opcodes()
    stale: list[dict[str, Any]] = []
    relocated_count = 0

    glossary = read_jsonl(_jsonl_path(project_path, "glossary"))
    glossary_changed = False
    for row in glossary:
        for occ in row.get("occurrences", []):
            if occ.get("block_id") == block_id:
                span = occ.get("span") or []
                expected = row.get("source_term")
                new_span = _reanchor_span(old_text, new_text, span, expected, opcodes)
                if new_span is None:
                    stale.append({"kind": "term", "id": row.get("term_id"), "expected_surface": expected, "span": span})
                elif new_span != span:
                    occ["span"] = new_span
                    glossary_changed = True
                    relocated_count += 1
    if glossary_changed:
        write_jsonl_atomic(_jsonl_path(project_path, "glossary"), glossary)

    entities = read_jsonl(_jsonl_path(project_path, "entities"))
    entities_changed = False
    for row in entities:
        for mention in row.get("mentions", []):
            if mention.get("block_id") == block_id and mention.get("span"):
                span = mention.get("span") or []
                expected = mention.get("surface")
                new_span = _reanchor_span(old_text, new_text, span, expected, opcodes)
                if new_span is None:
                    stale.append({"kind": "entity", "id": row.get("entity_id"), "expected_surface": expected, "span": span})
                elif new_span != span:
                    mention["span"] = new_span
                    entities_changed = True
                    relocated_count += 1
    if entities_changed:
        write_jsonl_atomic(_jsonl_path(project_path, "entities"), entities)

    return stale, relocated_count


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
    old_clean_text = block.get("clean_text") or ""
    stale_spans: list[dict[str, Any]] = []
    relocated_count = 0
    if "clean_text" in payload and payload["clean_text"] != old_clean_text:
        stale_spans, relocated_count = _reanchor_or_stale_spans_for_block(
            project_path,
            block_id,
            old_clean_text,
            str(payload["clean_text"]),
        )
        _mark_needs_retag(project_path, document, block_id, bool(stale_spans))
    for key in EDITABLE_BLOCK:
        if key in payload:
            block[key] = payload[key]
    _write_document(project_path, document)
    log_event(project_path, "patch_block", {
        "block_id": block_id,
        "fields": sorted(set(payload) & EDITABLE_BLOCK),
        "relocated_count": relocated_count,
        "stale_count": len(stale_spans),
    }, user)
    return {"block": block, "stale_spans": stale_spans, "relocated_count": relocated_count}


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
    if target.get("status") in {"locked", "human_verified"}:
        raise MutationError("locked_term", "Locked or human-verified terms cannot be deleted.")

    removed_block_refs = 0
    for chapter in document.get("chapters", []):
        for block in chapter.get("blocks", []):
            refs = (block.get("annotations") or {}).get("term_occurrences", [])
            if term_id in refs:
                kept_refs = [ref for ref in refs if ref != term_id]
                removed_block_refs += len(refs) - len(kept_refs)
                block.setdefault("annotations", {})["term_occurrences"] = kept_refs

    kept = [row for row in rows if row.get("term_id") != term_id]
    write_jsonl_atomic(_jsonl_path(project_path, "glossary"), kept)
    _write_document(project_path, document)
    removed_occurrences = len(target.get("occurrences") or [])
    log_event(project_path, "delete_glossary", {
        "term_id": term_id,
        "removed_occurrences": removed_occurrences,
        "removed_block_refs": removed_block_refs,
    }, user)
    return {
        "term_id": term_id,
        "deleted": True,
        "removed_occurrences": removed_occurrences,
        "removed_block_refs": removed_block_refs,
    }


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

    external_refs: list[dict[str, Any]] = []
    for chapter in document.get("chapters", []):
        for block in chapter.get("blocks", []):
            discourse = block.get("discourse") or {}
            if discourse.get("speaker_entity_id") == entity_id:
                external_refs.append({"kind": "discourse", "block_id": block.get("block_id"), "field": "speaker_entity_id"})
            if discourse.get("addressee_entity_id") == entity_id:
                external_refs.append({"kind": "discourse", "block_id": block.get("block_id"), "field": "addressee_entity_id"})

    summaries = read_jsonl(_jsonl_path(project_path, "chapter_summaries"))
    for row in summaries:
        if entity_id in row.get("characters_present", []):
            external_refs.append({"kind": "summary", "chapter_id": row.get("chapter_id"), "field": "characters_present"})

    if external_refs:
        raise MutationError(
            "entity_still_referenced",
            "Entity is referenced by discourse or chapter summary. Remove those references first.",
            references=external_refs,
        )

    removed_block_refs = 0
    for chapter in document.get("chapters", []):
        for block in chapter.get("blocks", []):
            refs = (block.get("annotations") or {}).get("entity_mentions", [])
            if entity_id in refs:
                kept_refs = [ref for ref in refs if ref != entity_id]
                removed_block_refs += len(refs) - len(kept_refs)
                block.setdefault("annotations", {})["entity_mentions"] = kept_refs

    kept = [row for row in rows if row.get("entity_id") != entity_id]
    write_jsonl_atomic(_jsonl_path(project_path, "entities"), kept)
    _write_document(project_path, document)
    removed_mentions = len(target.get("mentions") or [])
    log_event(project_path, "delete_entity", {
        "entity_id": entity_id,
        "removed_mentions": removed_mentions,
        "removed_block_refs": removed_block_refs,
    }, user)
    return {
        "entity_id": entity_id,
        "deleted": True,
        "removed_mentions": removed_mentions,
        "removed_block_refs": removed_block_refs,
    }


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
