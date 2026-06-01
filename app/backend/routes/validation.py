from flask import Blueprint, request

from routes.common import error, ok
from services.audit_log import log_event
from services.validator import run_validator
from services.workspace import ProjectError, get_project_path, has_project


bp = Blueprint("validation", __name__)


@bp.post("/projects/<doc_id>/validate")
def validate_project(doc_id: str):
    try:
        if not has_project(doc_id):
            return error("missing_project", "Project not found", 404)
        project_path = get_project_path(doc_id)
        report = run_validator(project_path / "canonical")
        user = (request.get_json(silent=True) or {}).get("user", "local")
        log_event(project_path, "validate", {"ok": report.get("ok"), "exit_code": report.get("exit_code")}, user)
        return ok(report)
    except ProjectError as exc:
        return error("invalid_project", str(exc), 400)
