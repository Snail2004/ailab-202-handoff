from flask import Blueprint, request

from routes.common import error, ok
from services.mutations import MutationError
from services.references import lock_reference, review_reference, save_reference_draft
from services.workspace import ProjectError, get_project_path, has_project


bp = Blueprint("references", __name__)


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
        return error("project_error", str(exc), 400)
    raise exc


@bp.post("/projects/<doc_id>/references/draft")
def create_reference_draft(doc_id: str):
    payload = _payload()
    try:
        return ok(save_reference_draft(_project(doc_id), payload, _user(payload)), status=201)
    except Exception as exc:
        return _handle(exc)


@bp.post("/projects/<doc_id>/references/<reference_id>/review")
def review_reference_route(doc_id: str, reference_id: str):
    payload = _payload()
    try:
        return ok(review_reference(_project(doc_id), reference_id, payload, _user(payload)))
    except Exception as exc:
        return _handle(exc)


@bp.post("/projects/<doc_id>/references/<reference_id>/lock")
def lock_reference_route(doc_id: str, reference_id: str):
    payload = _payload()
    try:
        return ok(lock_reference(_project(doc_id), reference_id, _user(payload)))
    except Exception as exc:
        return _handle(exc)
