---
name: source-structure-normalizer
description: Generate safe StructurePlan JSON for AI-LAB TXT/EPUB literary source cleanup before extraction. Use when Codex, Claude, or another LLM agent must normalize source structure from candidate_parts by selecting front/back matter drops, chapter headings, merge_parts, EPUB section roles, and needs_human_check flags without rewriting source text.
---

# Source Structure Normalizer

Use this skill to turn `candidate_parts` from an immutable TXT/EPUB source into a `StructurePlan`.

The agent does **not** rewrite source text. It only returns JSON decisions by `part_index` and, for EPUB, `spine_index`. The backend applies and validates the plan with `services/structure_normalizer.py`.

## Required Context

Before producing a plan, read:

- `guidelines/SOURCE_STRUCTURE_NORMALIZER_SPEC.md` for the authoritative rules.
- `references/STRUCTURE_PLAN_CONTRACT.md` for the output contract and checklist.
- `references/CANTERVILLE_EXAMPLE.md` when you need a concrete example.

## Workflow

1. Receive `candidate_parts` from `build_candidate_parts(source)`.
2. Identify parts that are front/back matter.
3. Identify chapter heading parts in ascending order.
4. Add `merge_parts` only when adjacent parts are clearly one hard-wrapped paragraph.
5. For EPUB, classify whole spine sections with `epub_section_roles` when possible.
6. Flag uncertain parts with `needs_human_check` instead of guessing.
7. Return one JSON object only: the `StructurePlan`.
8. Run `validate_plan`; if it fails, repair the JSON plan rather than editing source text.
9. Run `apply_plan` to create `normalized_document.json`.

## Hard Rules

- Do not translate.
- Do not annotate glossary, entity, summary, reference, discourse, or `block_type`.
- Do not rewrite, paraphrase, normalize, or invent source content.
- Do not split a part by character offset.
- Do not drop real body text to make the source look clean.
- Echo `source_fingerprint` exactly.
- Use only allowed enums and JSON fields from the contract.
- If uncertain, keep the part and flag it.

## Output

Return only `StructurePlan` JSON. No Markdown, no explanation, no prose around the JSON.

See `references/STRUCTURE_PLAN_CONTRACT.md` for the exact shape.
