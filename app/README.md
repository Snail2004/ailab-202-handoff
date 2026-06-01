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

