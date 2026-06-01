from flask import Blueprint

from routes.common import error, ok
from services.workspace import ProjectError, get_project_path, has_project, list_projects, project_file_state


bp = Blueprint("projects", __name__)


@bp.get("/health")
def health():
    return ok({"status": "ready"})


@bp.get("/projects")
def projects_index():
    try:
        return ok(list_projects())
    except ProjectError as exc:
        return error("project_error", str(exc), 400)


@bp.get("/projects/<doc_id>")
def project_detail(doc_id: str):
    try:
        if not has_project(doc_id):
            return error("missing_project", "Project not found", 404)
        state = project_file_state(doc_id)
        state["root"] = str(get_project_path(doc_id))
        return ok(state)
    except ProjectError as exc:
        return error("invalid_project", str(exc), 400)
