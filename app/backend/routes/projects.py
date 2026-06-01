from flask import Blueprint, request

from routes.common import error, ok
from services.extraction import extract_project, read_job
from services.workspace import (
    ProjectError,
    create_project_shell,
    delete_project,
    get_project_path,
    has_project,
    list_projects,
    project_file_state,
    save_source_file,
    update_project_settings,
)


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


@bp.post("/projects")
def projects_create():
    payload = request.get_json(silent=True) or {}
    doc_id = str(payload.get("doc_id") or "")
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    try:
        return ok(create_project_shell(doc_id, metadata), status=201)
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


@bp.patch("/projects/<doc_id>")
def project_update(doc_id: str):
    payload = request.get_json(silent=True) or {}
    allowed = {"note"}
    unknown = sorted(set(payload) - allowed - {"user"})
    if unknown:
        return error("read_only_or_unknown_field", f"Field is not editable here: {unknown[0]}", 400)
    try:
        return ok(update_project_settings(doc_id, payload))
    except ProjectError as exc:
        return error("project_update_error", str(exc), 400)


@bp.delete("/projects/<doc_id>")
def project_delete(doc_id: str):
    payload = request.get_json(silent=True) or {}
    try:
        return ok(delete_project(doc_id, confirm_doc_id=payload.get("confirm_doc_id")))
    except ProjectError as exc:
        return error("project_delete_error", str(exc), 400)


@bp.post("/projects/<doc_id>/source")
def upload_source(doc_id: str):
    try:
        if not has_project(doc_id):
            return error("missing_project", "Project not found", 404)
        if "file" not in request.files:
            return error("missing_file", "Upload field 'file' is required.", 400)
        overwrite = str(request.form.get("overwrite", "")).lower() in {"1", "true", "yes"}
        file = request.files["file"]
        data = file.read()
        path = save_source_file(get_project_path(doc_id), file.filename or "source.txt", data, overwrite=overwrite)
        return ok({"filename": path.name, "size": len(data), "path": str(path)}, status=201)
    except ProjectError as exc:
        return error("source_upload_error", str(exc), 400)


@bp.post("/projects/<doc_id>/extract")
def extract(doc_id: str):
    payload = request.get_json(silent=True) or {}
    try:
        if not has_project(doc_id):
            return error("missing_project", "Project not found", 404)
        job = extract_project(get_project_path(doc_id), doc_id, overwrite=bool(payload.get("overwrite")), user=str(payload.get("user") or "local"))
        return ok(job, status=201)
    except ProjectError as exc:
        code = "confirm_overwrite_required" if "Confirm overwrite" in str(exc) else "extract_error"
        return error(code, str(exc), 400)


@bp.get("/projects/<doc_id>/jobs/<job_id>")
def job_detail(doc_id: str, job_id: str):
    try:
        if not has_project(doc_id):
            return error("missing_project", "Project not found", 404)
        return ok(read_job(get_project_path(doc_id), job_id))
    except ProjectError as exc:
        return error("job_error", str(exc), 404)
