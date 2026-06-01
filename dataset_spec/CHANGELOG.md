# AILAB Dataset Spec Kit Changelog

## 1.4.0

- Require `document.schema_version` to be `1.4.0`.
- Trim `block_type` to the literary set: `heading`, `paragraph`, `dialogue`, and `footnote`.
- Remove `formula`, `table_cell`, and `list_item` from `block_type`; these are technical/layout-oriented categories and are out of scope for the logical literary dataset.
- Golden sample: reclassify the former formula-like and list-item blocks as `paragraph`.
- Rationale: align block typing with document-level/literary MT practice, where the core units are chapter/paragraph and quoted dialogue, rather than PDF layout taxonomies.

## 1.3.0

- Require `document.schema_version` to be `1.3.0`.
- `manual_reference_subset.jsonl`: add required `source` (`human` | `ai_assisted_verified`) and `status` (`reviewed` | `locked`), plus optional `ai_model`, `prompt_id`, `ai_used_at`.
- Reference subset is now freeze-clean by construction: only `reviewed`/`locked` entries are allowed in the canonical file; in-progress drafts live in the working `translation_review_log.csv`.
- AI-assisted reference translations must be human-revised and reviewed before entering the file; raw AI output is never accepted as a gold reference.

## 1.2.0

- Require `document.schema_version` to be `1.2.0`.
- Add optional sidecar `chapter_summaries.jsonl` and schema `chapter_summary.schema.json`.
- Remove `chapter.summary_seed` from `document.json` to avoid two sources of truth for chapter summaries.
- Validator now checks chapter summaries: `chapter_id` exists and is unique, and `characters_present` entity ids exist when present.
- AI-LAB minimum for the MVP source is `summary_source` + `source`; richer chapter summary fields are optional and not graded.
- Freeze accepts only verified summary provenance through `source in {"human", "ai_assisted_verified"}`.

## 1.1.0

- Require `document.schema_version` to be `1.1.0`.
- Require each block to include non-empty `source_text` and `clean_text`.
- Require `chapters`, chapter `blocks`, glossary `occurrences`, and entity `mentions` to contain at least one item.
- Make the validator safe on Windows paths/output containing Vietnamese Unicode.
- Detect duplicate `term_id`, `entity_id`, and `reference_id`.
- Reject invalid spans where `end <= start` for sentence, provenance, glossary occurrence, and entity mention spans.
- Check that `reference_translation_id` points to a reference for the same block.
