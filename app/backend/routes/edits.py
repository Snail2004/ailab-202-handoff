from flask import Blueprint, request

from routes.common import error, ok
from services.mutations import (
    MutationError,
    add_entity_from_selection,
    add_glossary_from_selection,
    delete_glossary,
    patch_block,
    patch_block_review,
    patch_entity,
    patch_glossary,
    patch_metadata,
    patch_summary,
)
from services.workspace import ProjectError, get_project_path, has_project


bp = Blueprint("edits", __name__)


def _payload():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _user(payload: dict) -> str:
    return str(payload.get("user") or "local")


def _project(doc_id: str):
    if not has_project(doc_id):
        raise MutationError("missing_project", "Project not found", 404)
    return get_project_path(doc_id)


def _handle(exc: Exception):
    if isinstance(exc, MutationError):
        return error(exc.code, str(exc), exc.status)
    if isinstance(exc, ProjectError):
        return error("invalid_project", str(exc), 400)
    if isinstance(exc, FileNotFoundError):
        return error("missing_file", str(exc), 404)
    if isinstance(exc, ValueError):
        return error("invalid_request", str(exc), 400)
    raise exc


@bp.patch("/projects/<doc_id>/metadata")
def update_metadata(doc_id: str):
    payload = _payload()
    try:
        return ok(patch_metadata(_project(doc_id), payload, _user(payload)))
    except Exception as exc:
        return _handle(exc)


@bp.patch("/projects/<doc_id>/blocks/<block_id>")
def update_block(doc_id: str, block_id: str):
    payload = _payload()
    try:
        return ok(patch_block(_project(doc_id), block_id, payload, _user(payload)))
    except Exception as exc:
        return _handle(exc)


@bp.patch("/projects/<doc_id>/review/blocks/<block_id>")
def update_block_review(doc_id: str, block_id: str):
    payload = _payload()
    try:
        return ok(patch_block_review(_project(doc_id), block_id, payload, _user(payload)))
    except Exception as exc:
        return _handle(exc)


@bp.post("/projects/<doc_id>/glossary/from-selection")
def create_glossary_from_selection(doc_id: str):
    payload = _payload()
    try:
        return ok(add_glossary_from_selection(_project(doc_id), payload, _user(payload)), status=201)
    except Exception as exc:
        return _handle(exc)


@bp.patch("/projects/<doc_id>/glossary/<term_id>")
def update_glossary(doc_id: str, term_id: str):
    payload = _payload()
    try:
        return ok(patch_glossary(_project(doc_id), term_id, payload, _user(payload)))
    except Exception as exc:
        return _handle(exc)


@bp.delete("/projects/<doc_id>/glossary/<term_id>")
def remove_glossary(doc_id: str, term_id: str):
    payload = _payload()
    try:
        return ok(delete_glossary(_project(doc_id), term_id, _user(payload)))
    except Exception as exc:
        return _handle(exc)


@bp.post("/projects/<doc_id>/entities/from-selection")
def create_entity_from_selection(doc_id: str):
    payload = _payload()
    try:
        return ok(add_entity_from_selection(_project(doc_id), payload, _user(payload)), status=201)
    except Exception as exc:
        return _handle(exc)


@bp.patch("/projects/<doc_id>/entities/<entity_id>")
def update_entity(doc_id: str, entity_id: str):
    payload = _payload()
    try:
        return ok(patch_entity(_project(doc_id), entity_id, payload, _user(payload)))
    except Exception as exc:
        return _handle(exc)


@bp.patch("/projects/<doc_id>/summary/<chapter_id>")
def update_summary(doc_id: str, chapter_id: str):
    payload = _payload()
    try:
        return ok(patch_summary(_project(doc_id), chapter_id, payload, _user(payload)))
    except Exception as exc:
        return _handle(exc)
