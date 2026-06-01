#!/usr/bin/env python3
"""
AILAB dataset validator (AIL-202).

Two layers of checking:
  1. JSON Schema (structural) validation of:
       document.json, glossary.jsonl, entities.jsonl, manual_reference_subset.jsonl,
       chapter_summaries.jsonl
  2. Cross-file referential integrity (ref-by-id), which JSON Schema cannot express:
       - unique chapter_id / block_id
       - block.annotations.term_occurrences  -> term_id exists in glossary
       - block.annotations.entity_mentions   -> entity_id exists in entities
       - block.discourse.speaker/addressee    -> entity_id exists
       - block.reference_translation_id        -> reference_id exists
       - glossary.occurrences[].block_id       -> block exists
       - entities.mentions[].block_id          -> block exists
       - reference.block_id                     -> block exists
       - chapter_summaries.chapter_id           -> chapter exists and is unique
       - chapter_summaries.characters_present   -> entity_id exists
       - doc_id consistent across all files

NOTE on scope: schema validation is STRUCTURAL only. Freeze-time requirements
(provenance/license completeness, no extraction errors, IAA, versioning) are the
QC checklist in AILAB_PLAN.md, not enforced here.

Usage:
    python validate.py --dataset <dataset_dir> [--schema <schema_dir>]

<dataset_dir> contains document.json and (optionally) the .jsonl files.
Exit code: 0 = pass, 1 = validation errors, 2 = setup/usage error.

Requires: jsonschema >= 4.18  (Draft 2020-12)
"""
import argparse
import json
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("ERROR: missing dependency. Install with:  pip install 'jsonschema>=4.18'")
    sys.exit(2)

DATA_FILES = {
    "document": "document.json",
    "glossary": "glossary.jsonl",
    "entities": "entities.jsonl",
    "reference": "manual_reference_subset.jsonl",
    "chapter_summary": "chapter_summaries.jsonl",
}
SCHEMA_FILES = {
    "document": "document.schema.json",
    "glossary": "glossary.schema.json",
    "entities": "entity.schema.json",
    "reference": "reference_subset.schema.json",
    "chapter_summary": "chapter_summary.schema.json",
}


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for lineno, raw in enumerate(f, 1):
            line = raw.strip()
            if not line:
                continue
            rows.append((lineno, json.loads(line)))
    return rows


def loc_of(err):
    return "/".join(str(p) for p in err.path) or "(root)"


def check_span(span, fname, where, errors):
    if isinstance(span, list) and len(span) == 2 and span[1] <= span[0]:
        errors.append((fname, where, f"invalid span (end<=start): {span}"))


def collect_ids(rows, id_field, fname, errors):
    ids = set()
    for _, obj in rows:
        value = obj.get(id_field)
        if value in ids:
            errors.append((fname, id_field, f"duplicate {id_field}: {value}"))
        ids.add(value)
    return ids


def main():
    ap = argparse.ArgumentParser(description="Validate an AILAB dataset folder.")
    ap.add_argument("--dataset", required=True, help="dataset dir (has document.json + jsonl files)")
    ap.add_argument("--schema", default=str(Path(__file__).resolve().parent.parent / "schema"),
                    help="schema dir (default: ../schema next to this script)")
    args = ap.parse_args()

    ds = Path(args.dataset)
    sd = Path(args.schema)
    if not ds.is_dir():
        print(f"ERROR: dataset dir not found: {ds}")
        sys.exit(2)

    # build validators
    validators = {}
    for key, fn in SCHEMA_FILES.items():
        sp = sd / fn
        if not sp.exists():
            print(f"ERROR: schema not found: {sp}")
            sys.exit(2)
        try:
            schema = load_json(sp)
        except json.JSONDecodeError as e:
            print(f"ERROR: schema {fn} is not valid JSON: {e}")
            sys.exit(2)
        validators[key] = Draft202012Validator(schema)

    errors = []     # (file, location, message)
    warnings = []

    block_ids, chapter_ids = set(), set()
    dup_blocks, dup_chapters = [], []
    term_ids, entity_ids, reference_ids = set(), set(), set()
    reference_blocks = {}
    doc_ids_seen = set()

    # ---- document.json ----
    doc = None
    dpath = ds / DATA_FILES["document"]
    if not dpath.exists():
        errors.append((DATA_FILES["document"], "-", "missing (document.json is required)"))
    else:
        try:
            doc = load_json(dpath)
        except json.JSONDecodeError as e:
            errors.append((DATA_FILES["document"], "-", f"invalid JSON: {e}"))
    if doc is not None:
        for err in validators["document"].iter_errors(doc):
            errors.append((DATA_FILES["document"], loc_of(err), err.message))
        doc_ids_seen.add(doc.get("doc_id"))
        for ch in doc.get("chapters", []):
            cid = ch.get("chapter_id")
            if cid in chapter_ids:
                dup_chapters.append(cid)
            chapter_ids.add(cid)
            for b in ch.get("blocks", []):
                bid = b.get("block_id")
                if bid in block_ids:
                    dup_blocks.append(bid)
                block_ids.add(bid)
                for sent in b.get("sentences", []):
                    check_span(sent.get("span"), DATA_FILES["document"], f"block {bid} sentence {sent.get('sent_id')}", errors)
                prov = b.get("provenance") or {}
                check_span(prov.get("raw_span"), DATA_FILES["document"], f"block {bid} provenance.raw_span", errors)

    # ---- jsonl files ----
    def validate_jsonl(key):
        path = ds / DATA_FILES[key]
        if not path.exists():
            warnings.append(f"{DATA_FILES[key]} not present (optional) - skipped")
            return []
        try:
            rows = load_jsonl(path)
        except json.JSONDecodeError as e:
            errors.append((DATA_FILES[key], "-", f"invalid JSON line: {e}"))
            return []
        for lineno, obj in rows:
            for err in validators[key].iter_errors(obj):
                errors.append((DATA_FILES[key], f"line {lineno}:{loc_of(err)}", err.message))
            doc_ids_seen.add(obj.get("doc_id"))
        return rows

    gl = validate_jsonl("glossary")
    en = validate_jsonl("entities")
    rf = validate_jsonl("reference")
    cs = validate_jsonl("chapter_summary")

    term_ids = collect_ids(gl, "term_id", DATA_FILES["glossary"], errors)
    entity_ids = collect_ids(en, "entity_id", DATA_FILES["entities"], errors)
    reference_ids = collect_ids(rf, "reference_id", DATA_FILES["reference"], errors)
    for _, o in rf:
        reference_blocks[o.get("reference_id")] = o.get("block_id")

    # ---- chapter summaries (optional sidecar) ----
    summary_chapter_ids = set()
    for _, o in cs:
        chid = o.get("chapter_id")
        if chid in summary_chapter_ids:
            errors.append((DATA_FILES["chapter_summary"], "chapter_id",
                           f"duplicate chapter summary for chapter_id: {chid}"))
        summary_chapter_ids.add(chid)
        if chid not in chapter_ids:
            errors.append((DATA_FILES["chapter_summary"], chid,
                           f"chapter_id not in document: {chid}"))
        for eid in o.get("characters_present", []):
            if eid not in entity_ids:
                errors.append((DATA_FILES["chapter_summary"], chid,
                               f"characters_present -> unknown entity_id: {eid}"))

    # ---- referential integrity ----
    for cid in dup_chapters:
        errors.append((DATA_FILES["document"], "chapters", f"duplicate chapter_id: {cid}"))
    for bid in dup_blocks:
        errors.append((DATA_FILES["document"], "blocks", f"duplicate block_id: {bid}"))

    doc_ids_seen.discard(None)
    if len(doc_ids_seen) > 1:
        errors.append(("(cross-file)", "doc_id", f"inconsistent doc_id across files: {sorted(doc_ids_seen)}"))

    if doc is not None:
        for ch in doc.get("chapters", []):
            for b in ch.get("blocks", []):
                bid = b.get("block_id")
                ann = b.get("annotations") or {}
                for tid in ann.get("term_occurrences", []):
                    if tid not in term_ids:
                        errors.append((DATA_FILES["document"], f"block {bid}", f"term_occurrences -> unknown term_id: {tid}"))
                for eid in ann.get("entity_mentions", []):
                    if eid not in entity_ids:
                        errors.append((DATA_FILES["document"], f"block {bid}", f"entity_mentions -> unknown entity_id: {eid}"))
                disc = b.get("discourse") or {}
                for fld in ("speaker_entity_id", "addressee_entity_id"):
                    v = disc.get(fld)
                    if v and v not in entity_ids:
                        errors.append((DATA_FILES["document"], f"block {bid}", f"discourse.{fld} -> unknown entity_id: {v}"))
                rtid = b.get("reference_translation_id")
                if rtid and rtid not in reference_ids:
                    errors.append((DATA_FILES["document"], f"block {bid}", f"reference_translation_id -> unknown reference_id: {rtid}"))
                elif rtid and reference_blocks.get(rtid) != bid:
                    errors.append((DATA_FILES["document"], f"block {bid}", f"reference_translation_id {rtid} points to a different block_id: {reference_blocks.get(rtid)}"))

    for _, o in gl:
        for occ in o.get("occurrences", []):
            check_span(occ.get("span"), DATA_FILES["glossary"], f"{o.get('term_id')} occurrence {occ.get('block_id')}", errors)
            if occ.get("block_id") not in block_ids:
                errors.append((DATA_FILES["glossary"], o.get("term_id"), f"occurrence block_id not in document: {occ.get('block_id')}"))
    for _, o in en:
        for m in o.get("mentions", []):
            check_span(m.get("span"), DATA_FILES["entities"], f"{o.get('entity_id')} mention {m.get('block_id')}", errors)
            if m.get("block_id") not in block_ids:
                errors.append((DATA_FILES["entities"], o.get("entity_id"), f"mention block_id not in document: {m.get('block_id')}"))
    for _, o in rf:
        if o.get("block_id") not in block_ids:
            errors.append((DATA_FILES["reference"], o.get("reference_id"), f"block_id not in document: {o.get('block_id')}"))

    # ---- report ----
    print("=" * 64)
    print(f"AILAB dataset validation: {ds}")
    print(f"  chapters={len(chapter_ids)} blocks={len(block_ids)} "
          f"terms={len(term_ids)} entities={len(entity_ids)} reference={len(reference_ids)} "
          f"summaries={len(cs)}")
    for w in warnings:
        print(f"  [warn] {w}")
    if not errors:
        print("RESULT: PASS - no errors")
        print("=" * 64)
        sys.exit(0)
    print(f"RESULT: FAIL - {len(errors)} error(s)")
    for fname, location, msg in errors:
        print(f"  [{fname}] {location}: {msg}")
    print("=" * 64)
    sys.exit(1)


if __name__ == "__main__":
    main()
