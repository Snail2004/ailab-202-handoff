# Spec Kit - Schema + Validator (AIL-202)

This folder defines the canonical data format for the AI-LAB EN->VI long-text dataset. Every dataset source must validate before it can enter a freeze.

Current schema version: `1.4.0` (`document.schema_version` must be `1.4.0`).

## Structure

```text
dataset/
  schema/
    document.schema.json          # document.json
    glossary.schema.json          # one line of glossary.jsonl
    entity.schema.json            # one line of entities.jsonl
    reference_subset.schema.json  # one line of manual_reference_subset.jsonl
    chapter_summary.schema.json   # one line of chapter_summaries.jsonl
  tools/
    validate.py                   # schema + referential integrity validator
    requirements.txt
    README.md
```

A single dataset source folder looks like:

```text
<doc_id>/
  document.json
  glossary.jsonl                  # optional
  entities.jsonl                  # optional
  manual_reference_subset.jsonl   # optional
  chapter_summaries.jsonl         # optional
```

## Install

```powershell
pip install -r requirements.txt
```

## Run

```powershell
python validate.py --dataset path/to/<doc_id>
python validate.py --dataset path/to/<doc_id> --schema path/to/schema
```

Exit code: `0` = pass, `1` = validation errors, `2` = setup/path/dependency error.

## Validator Layers

1. **Schema validation:** required fields, field types, enum values, and no unknown fields (`additionalProperties:false`).
2. **Referential integrity:** checks JSON Schema cannot express:
   - `chapter_id` / `block_id` are unique;
   - `annotations.term_occurrences` -> `term_id` exists in glossary;
   - `annotations.entity_mentions` -> `entity_id` exists in entities;
   - `discourse.speaker/addressee_entity_id` -> entity exists;
   - `reference_translation_id` -> reference exists and belongs to the same `block_id`;
   - `occurrences/mentions/reference.block_id` -> block exists;
   - `term_id` / `entity_id` / `reference_id` are not duplicated;
   - spans use `[start, end]` with `end > start`;
   - `chapter_summaries.chapter_id` exists in `document.json` and is not duplicated;
   - `chapter_summaries.characters_present[]` -> entity exists;
   - `doc_id` is consistent across files.

## Chapter Summary (1.2.0)

`chapter_summaries.jsonl` is an optional sidecar for chapter-level context.

AI-LAB minimum for the MVP source:

- `summary_source`: 1-3 sentence source-language chapter summary.
- `source`: `human` or `ai_assisted_verified`.

Optional fields such as `characters_present`, `key_events`, `setting`, `emotional_tone`, `motifs`, `summary_target`, `open_threads`, and `translation_notes` are useful for later downstream experiments but are not graded for the AI-LAB task.

Workflow rule: write `summary_source` right after a chapter has been annotated/reviewed, while context is fresh. Do not batch all summaries at the end.

Freeze rule: no unverified AI draft value is allowed in `source`; the schema only accepts `human` and `ai_assisted_verified`.

Clarifications:

- chapter `emotional_tone` = tone of the full chapter;
- block `annotations.tone` = local tone of one block;
- chapter `motifs` are free hints, not IAA-scored controlled labels;
- the validator does not require every chapter to have a summary. Coverage is a QC/DoD decision.

## Manual Reference Subset

`manual_reference_subset.jsonl` is a small, stratified, human-owned EN->VI reference subset (not a full parallel translation).

Required per line: `reference_id`, `doc_id`, `block_id`, `source_text`, `reference_vi`, `source`, `status`.

- `source`: `human` or `ai_assisted_verified` (translation method).
- `status`: `reviewed` or `locked` only. This file is freeze-clean: drafts are NOT allowed here.
- Optional AI provenance: `ai_model`, `prompt_id`, `ai_used_at`.

Workflow: in-progress drafts live in the working `translation_review_log.csv`; an entry moves into this JSONL only after a second reviewer marks it `reviewed`. AI-assisted output must be human-revised before it can be `reviewed`. Raw AI output is never accepted as a gold reference.

## Block Types (1.4.0)

`block_type` is a logical content/discourse type, not a layout class. The literary set is:

- `heading`: chapter/section titles.
- `paragraph`: narration and normal prose.
- `dialogue`: a speech turn or quoted speech that should use `discourse` when speaker/addressee are known.
- `footnote`: author/editor/translator notes kept separate from narration.

`formula`, `table_cell`, and `list_item` were removed in 1.4.0. They belong to document layout analysis or technical-document processing, which is out of scope for this logical literary dataset. Add a type back only via a schema version bump if a real source requires it.

## Field Ownership

The schema is intentionally richer than the minimum required fields, but a single LLM agent is not expected to fill everything.

| Field group | Owner | Rule |
|---|---|---|
| ids, order, `source_text`, provenance | pipeline/code | deterministic and read-only after extraction |
| `sentences[]`, `span`, occurrence offsets | code or UI selection | do not ask an LLM to count character offsets |
| `clean_text`, `block_type`, `quality_flags` | code draft + annotator review | human can correct extraction/classification errors |
| glossary/entity candidates, chapter summaries | AI draft + human verify | AI draft cannot enter freeze without review |
| `motifs`, `tone`, `implicit_meaning`, `narrative_note` | optional hint | fill only when useful and evidence-backed |
| `reference_vi`, license, contamination risk, freeze status | human/reviewer/lead | human-owned and review-gated |

Validator pass means the files are structurally valid. It does not prove that a summary, tone label, implicit meaning, or Vietnamese reference translation is correct.

## Quality Flags And Narrative Hints

`quality_flags` is currently a string array. Use a small controlled vocabulary in practice:

- `ok`
- `needs_review`
- `extraction_error`
- `ocr_suspect`
- `broken_paragraph`
- `unclear_dialogue`
- `license_check_needed`

Block-level narrative fields are optional hints:

- `motifs`
- `tone`
- `implicit_meaning`
- `narrative_note`

Do not fill them just to make the JSON look complete. If the meaning is not clear, leave `motifs` empty and `tone` / `implicit_meaning` / `narrative_note` as `null`.

## Boundary: Schema vs QC Freeze

This validator checks structure and references only. Freeze-time requirements such as license/provenance completeness, no unresolved extraction errors, IAA, versioning, and reviewer approval remain part of the QC checklist in `../../AILAB_PLAN.md`.

Adding or removing fields requires a schema version bump and a CHANGELOG entry. Unknown fields will fail validation.

## Suggested ID Convention

- `doc_id`: `d2_alice`
- `chapter_id`: `<doc_id>_ch001`
- `block_id`: `<doc_id>_ch001_b0001`
- `term_id`: `g_001`
- `entity_id`: `e_001`
- `reference_id`: `ref_001`
