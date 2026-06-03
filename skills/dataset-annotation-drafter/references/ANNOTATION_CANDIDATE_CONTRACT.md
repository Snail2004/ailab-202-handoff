# Annotation Candidate Contract

## Input

The agent receives one chapter at a time:

```json
{
  "doc_id": "frankenstein_epub",
  "chapter_id": "frankenstein_epub_ch01",
  "blocks": [
    {
      "block_id": "frankenstein_epub_ch01_b004",
      "clean_text": "You will rejoice...",
      "block_type": "paragraph"
    }
  ],
  "known_entities": [
    {
      "entity_id": "e_001",
      "canonical_source": "Margaret Saville",
      "aliases_source": ["Mrs. Saville", "Margaret"]
    }
  ],
  "known_terms": [
    {
      "term_id": "g_001",
      "source_term": "enterprise",
      "expected_target": "dự án"
    }
  ]
}
```

Use `known_entities` and `known_terms` to preserve consistency across chapters. Create a new candidate only when the item is not already represented.

## Output

Return exactly one JSON object:

```json
{
  "doc_id": "frankenstein_epub",
  "chapter_id": "frankenstein_epub_ch01",
  "entity_candidates": [
    {
      "existing_entity_id": null,
      "entity_key": "margaret_saville",
      "canonical_source": "Margaret Saville",
      "suggested_canonical_target": "Margaret Saville",
      "entity_type": "person",
      "gender": "female",
      "aliases_source": ["Mrs. Saville", "my dear sister", "Margaret"],
      "aliases_target": ["bà Saville", "người chị thân yêu", "Margaret"],
      "pronoun_policy": "bà / chị / chị ấy tùy văn cảnh thư từ",
      "mentions": [
        {
          "block_id": "frankenstein_epub_ch01_b002",
          "surface": "Mrs. Saville",
          "left_context": "To ",
          "right_context": ", England."
        }
      ],
      "reason": "addressee of Walton's letters; addressed by aliases across the chapter",
      "confidence": 0.95
    }
  ],
  "glossary_candidates": [
    {
      "existing_term_id": null,
      "term_key": "enterprise",
      "source_term": "enterprise",
      "suggested_expected_target": "dự án",
      "suggested_allowed_variants": ["công cuộc", "cuộc viễn chinh"],
      "suggested_forbidden_variants": ["doanh nghiệp"],
      "occurrences": [
        {
          "block_id": "frankenstein_epub_ch01_b004",
          "surface": "enterprise",
          "left_context": "commencement of an ",
          "right_context": " which you"
        }
      ],
      "reason": "recurring literary term needing consistent translation",
      "confidence": 0.9
    }
  ],
  "discourse_candidates": [
    {
      "block_id": "frankenstein_epub_ch01_b004",
      "speaker_ref": "walton",
      "addressee_ref": "margaret_saville",
      "reason": "first-person letter from Walton to Margaret",
      "confidence": 0.9
    }
  ],
  "summary_candidate": {
    "summary_source": "Letter I introduces Walton writing to Margaret Saville from St. Petersburgh about his northern voyage.",
    "characters_present_refs": ["walton", "margaret_saville"],
    "setting": "St. Petersburgh and the imagined northern route toward the pole",
    "emotional_tone": "aspiring, intimate, anxious",
    "motifs": ["ambition", "exploration", "sibling correspondence"],
    "confidence": 0.85
  },
  "warnings": [
    {
      "block_id": "frankenstein_epub_ch01_b005",
      "issue": "ambiguous_surface",
      "note": "A pronoun-like surface appears more than once; no candidate emitted."
    }
  ],
  "confidence": 0.86
}
```

## Field Rules

- `doc_id` and `chapter_id`: echo the input exactly.
- `existing_entity_id`: set when the candidate clearly matches a known entity; otherwise use `null`.
- `entity_key`: required when `existing_entity_id` is `null`. Use a stable lowercase slug, e.g. `margaret_saville`.
- `existing_term_id`: set when the candidate clearly matches a known term; otherwise use `null`.
- `term_key`: required when `existing_term_id` is `null`. Use a stable lowercase slug based on `source_term`.
- `surface`: copy exact text from `clean_text`.
- `left_context` / `right_context`: provide enough local context to distinguish duplicate surfaces. Prefer 5-40 characters on each side.
- `speaker_ref`, `addressee_ref`, and `characters_present_refs`: reference either an `entity_key` emitted in this JSON or an `existing_entity_id` from input.
- `suggested_*`: draft translation targets only. A human reviewer must approve them.
- `confidence`: number from 0 to 1.

## Prohibited Fields

Do not emit:

```text
span
start
end
entity.status
glossary.status
reference_vi
draft_vi
```

Entity schema has no `status`. Glossary status is assigned by the apply/review workflow, not by the agent.

## Resolve/Apply Contract For Future Backend

The backend apply step should:

1. Resolve or create entities first, mapping `entity_key` to `entity_id`.
2. Resolve glossary terms after entity decisions, preventing dual-tagged surfaces.
3. Resolve spans by exact `surface` plus `left_context` / `right_context`.
4. Assert `clean_text[start:end] == surface`.
5. Flag zero-match or multi-match cases for human selection.
6. Apply discourse and summary only after referenced entities are resolved.
7. Preserve provenance (`ai_model`, `prompt_id`, `annotated_by`) and keep candidates in review state.

If a referenced entity candidate is rejected by review, discourse and summary links pointing to it must be flagged, not silently dropped.
