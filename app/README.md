# App Notes

`WEB_TOOL_SPEC.md` là source chính cho app AI-LAB Dataset Tool.

App này là local-first dataset construction tool:

```text
Upload source -> Extract -> Review/Clean -> Annotate -> Validate -> Export/Freeze
```

Không phải app dịch, không phải app OCR, không phải PDF layout editor.

## Kiến trúc khuyến nghị

- Backend: Python Flask.
- Frontend: vanilla HTML/CSS/JS.
- Data: local filesystem project workspace.
- Validation: backend gọi `dataset_spec/tools/validate.py`.

## Module code gợi ý

| Module | Trách nhiệm |
|---|---|
| Project manager | tạo/mở project, upload source, provenance |
| Extraction backend | TXT/EPUB -> `document.json` |
| Block UI | chapter/block browser, clean editor |
| Annotation UI | glossary/entity/summary/reference |
| Validation/export | validate, error view, freeze/export |
| Persistence | autosave, logs, resume |

## UI prototype

`prototype/` chứa bản UI prototype tải từ Claude Design. Đây là wireframe tương tác để tham khảo khi code frontend thật, chưa phải backend hoàn chỉnh.

Chạy xem nhanh:

```powershell
cd app/prototype
python -m http.server 8765 --bind 127.0.0.1
```

Mở `http://127.0.0.1:8765/index.html`.

## Backend Phase 1

`backend/` chứa Flask API skeleton local cho AI-LAB Dataset Tool. Backend đọc dataset thật từ filesystem workspace và gọi `dataset_spec/tools/validate.py --json`.

Chạy:

```powershell
cd app\backend
python -m pip install -r requirements.txt
python app.py
```

API mặc định:

```text
http://127.0.0.1:5000/api
```

Smoke checks:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/health
Invoke-RestMethod http://127.0.0.1:5000/api/projects
Invoke-RestMethod http://127.0.0.1:5000/api/projects/gold_demo_01
Invoke-RestMethod http://127.0.0.1:5000/api/projects/gold_demo_01/dataset
Invoke-RestMethod -Method Post http://127.0.0.1:5000/api/projects/gold_demo_01/validate
```

Lần chạy đầu, backend seed `gold_demo_01` từ `dataset_spec/sample/gold_demo_01` vào `ailab_projects/gold_demo_01`. Workspace này là dữ liệu runtime local và đã được Git ignore.
