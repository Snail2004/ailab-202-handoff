import os
import sys
import tempfile
import unittest
import json
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile


class BackendApiSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ["AILAB_PROJECTS_ROOT"] = cls.tmp.name
        backend_root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(backend_root))

        from app import create_app

        cls.client = create_app().test_client()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()
        os.environ.pop("AILAB_PROJECTS_ROOT", None)

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])

    def _make_txt_project(self, doc_id: str, source: bytes | None = None) -> dict:
        self.client.post("/api/projects", json={
            "doc_id": doc_id,
            "metadata": {
                "title": doc_id,
                "author": "Tester",
                "source_format": "txt",
                "license": "public-domain",
                "contamination_risk": "low",
            },
        })
        self.client.post(
            f"/api/projects/{doc_id}/source",
            data={"file": (BytesIO(source or b"Chapter 1\n\nAlice arrived.\n\nBob waited."), "source.txt")},
            content_type="multipart/form-data",
        )
        extract = self.client.post(f"/api/projects/{doc_id}/extract", json={"overwrite": False, "user": "tester"})
        self.assertEqual(extract.status_code, 201)
        return self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]

    def test_seed_project_and_dataset(self):
        projects = self.client.get("/api/projects").get_json()
        self.assertTrue(projects["ok"])
        self.assertEqual(projects["data"][0]["doc_id"], "gold_demo_01")

        dataset = self.client.get("/api/projects/gold_demo_01/dataset").get_json()
        self.assertTrue(dataset["ok"])
        self.assertEqual(len(dataset["data"]["blocks"]), 14)
        self.assertEqual(len(dataset["data"]["chapters"]), 2)
        self.assertIn("reference_drafts", dataset["data"])
        self.assertIn("jobs", dataset["data"])

    def test_validate_project(self):
        response = self.client.post("/api/projects/gold_demo_01/validate")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["data"]["ok"])
        self.assertEqual(payload["data"]["exit_code"], 0)

    def test_undo_redo_clean_text(self):
        doc_id = "history_clean"
        dataset = self._make_txt_project(doc_id)
        block = next(block for block in dataset["blocks"] if block["block_type"] != "heading")
        old_text = block["clean_text"]
        new_text = "Alice arrived, then looked back."

        patch = self.client.patch(f"/api/projects/{doc_id}/blocks/{block['block_id']}", json={
            "clean_text": new_text,
            "user": "tester",
        })
        self.assertEqual(patch.status_code, 200)
        history = self.client.get(f"/api/projects/{doc_id}/history").get_json()["data"]
        self.assertTrue(history["can_undo"])
        self.assertFalse(history["can_redo"])

        undo = self.client.post(f"/api/projects/{doc_id}/undo", json={"user": "tester"})
        self.assertEqual(undo.status_code, 200)
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        restored = next(item for item in dataset["blocks"] if item["block_id"] == block["block_id"])
        self.assertEqual(restored["clean_text"], old_text)
        self.assertTrue(dataset["history_state"]["can_redo"])

        redo = self.client.post(f"/api/projects/{doc_id}/redo", json={"user": "tester"})
        self.assertEqual(redo.status_code, 200)
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        redone = next(item for item in dataset["blocks"] if item["block_id"] == block["block_id"])
        self.assertEqual(redone["clean_text"], new_text)

    def test_undo_redo_glossary_add(self):
        doc_id = "history_glossary"
        dataset = self._make_txt_project(doc_id)
        block = next(block for block in dataset["blocks"] if "Alice" in block["clean_text"])
        start = block["clean_text"].index("Alice")
        end = start + len("Alice")

        created = self.client.post(f"/api/projects/{doc_id}/glossary/from-selection", json={
            "block_id": block["block_id"],
            "start": start,
            "end": end,
            "source_term": "Alice",
            "expected_target": "Alice",
            "user": "tester",
        })
        self.assertEqual(created.status_code, 201)
        term_id = created.get_json()["data"]["term_id"]
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        self.assertTrue(any(term["term_id"] == term_id for term in dataset["glossary"]))

        self.client.post(f"/api/projects/{doc_id}/undo", json={"user": "tester"})
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        self.assertFalse(any(term["term_id"] == term_id for term in dataset["glossary"]))
        restored_block = next(item for item in dataset["blocks"] if item["block_id"] == block["block_id"])
        self.assertNotIn(term_id, (restored_block.get("annotations") or {}).get("term_occurrences", []))

        self.client.post(f"/api/projects/{doc_id}/redo", json={"user": "tester"})
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        self.assertTrue(any(term["term_id"] == term_id for term in dataset["glossary"]))

    def test_undo_redo_review_state(self):
        doc_id = "history_review"
        dataset = self._make_txt_project(doc_id)
        block_id = dataset["blocks"][0]["block_id"]

        review = self.client.patch(f"/api/projects/{doc_id}/review/blocks/{block_id}", json={
            "reviewed": True,
            "reviewed_by": "tester",
            "user": "tester",
        })
        self.assertEqual(review.status_code, 200)
        self.client.post(f"/api/projects/{doc_id}/undo", json={"user": "tester"})
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        self.assertFalse(dataset["review_state"]["blocks"][block_id]["reviewed"])

        self.client.post(f"/api/projects/{doc_id}/redo", json={"user": "tester"})
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        self.assertTrue(dataset["review_state"]["blocks"][block_id]["reviewed"])

    def test_history_redo_clears_after_new_mutation(self):
        doc_id = "history_clear"
        dataset = self._make_txt_project(doc_id)
        block = next(block for block in dataset["blocks"] if block["block_type"] != "heading")
        self.client.patch(f"/api/projects/{doc_id}/blocks/{block['block_id']}", json={
            "clean_text": "First edit.",
            "user": "tester",
        })
        self.client.post(f"/api/projects/{doc_id}/undo", json={"user": "tester"})
        history = self.client.get(f"/api/projects/{doc_id}/history").get_json()["data"]
        self.assertTrue(history["can_redo"])

        self.client.patch(f"/api/projects/{doc_id}/blocks/{block['block_id']}", json={
            "quality_flags": ["needs_review"],
            "user": "tester",
        })
        history = self.client.get(f"/api/projects/{doc_id}/history").get_json()["data"]
        self.assertFalse(history["can_redo"])

    def test_validate_does_not_create_history_and_empty_undo_fails(self):
        doc_id = "history_noop"
        self._make_txt_project(doc_id)
        history = self.client.get(f"/api/projects/{doc_id}/history").get_json()["data"]
        self.assertFalse(history["can_undo"])

        validate = self.client.post(f"/api/projects/{doc_id}/validate", json={"user": "tester"})
        self.assertEqual(validate.status_code, 200)
        history = self.client.get(f"/api/projects/{doc_id}/history").get_json()["data"]
        self.assertFalse(history["can_undo"])

        undo = self.client.post(f"/api/projects/{doc_id}/undo", json={"user": "tester"})
        self.assertEqual(undo.status_code, 409)
        self.assertEqual(undo.get_json()["errors"][0]["code"], "empty_undo_stack")

    def test_reference_draft_undo_redo_keeps_csv_in_sync(self):
        doc_id = "history_reference_csv"
        dataset = self._make_txt_project(doc_id)
        block = next(block for block in dataset["blocks"] if block["block_type"] != "heading")
        working = Path(self.tmp.name) / doc_id / "working"
        drafts_path = working / "drafts.json"
        csv_path = working / "translation_review_log.csv"

        draft_a = self.client.post(f"/api/projects/{doc_id}/references/draft", json={
            "block_id": block["block_id"],
            "reference_vi": "BAN_DICH_A_UNIQUE",
            "source": "human",
            "translated_by": "tester",
            "user": "tester",
        })
        self.assertEqual(draft_a.status_code, 201)
        reference_id = draft_a.get_json()["data"]["reference_id"]
        self.assertIn("BAN_DICH_A_UNIQUE", csv_path.read_text(encoding="utf-8"))

        draft_b = self.client.post(f"/api/projects/{doc_id}/references/draft", json={
            "reference_id": reference_id,
            "block_id": block["block_id"],
            "reference_vi": "BAN_DICH_B_UNIQUE",
            "source": "human",
            "translated_by": "tester",
            "user": "tester",
        })
        self.assertEqual(draft_b.status_code, 201)
        self.assertIn("BAN_DICH_B_UNIQUE", csv_path.read_text(encoding="utf-8"))

        undo = self.client.post(f"/api/projects/{doc_id}/undo", json={"user": "tester"})
        self.assertEqual(undo.status_code, 200)
        drafts = json.loads(drafts_path.read_text(encoding="utf-8"))
        self.assertEqual(drafts["references"][reference_id]["reference_vi"], "BAN_DICH_A_UNIQUE")
        csv_text = csv_path.read_text(encoding="utf-8")
        self.assertIn("BAN_DICH_A_UNIQUE", csv_text)
        self.assertNotIn("BAN_DICH_B_UNIQUE", csv_text)

        redo = self.client.post(f"/api/projects/{doc_id}/redo", json={"user": "tester"})
        self.assertEqual(redo.status_code, 200)
        drafts = json.loads(drafts_path.read_text(encoding="utf-8"))
        self.assertEqual(drafts["references"][reference_id]["reference_vi"], "BAN_DICH_B_UNIQUE")
        csv_text = csv_path.read_text(encoding="utf-8")
        self.assertIn("BAN_DICH_B_UNIQUE", csv_text)
        self.assertNotIn("BAN_DICH_A_UNIQUE", csv_text)

    def test_patch_metadata_persists(self):
        response = self.client.patch("/api/projects/gold_demo_01/metadata", json={
            "title": "[SYNTHETIC DEMO] The Turning - Edited",
            "user": "tester",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"]["title"], "[SYNTHETIC DEMO] The Turning - Edited")

        dataset = self.client.get("/api/projects/gold_demo_01/dataset").get_json()
        self.assertEqual(dataset["data"]["document"]["metadata"]["title"], "[SYNTHETIC DEMO] The Turning - Edited")

    def test_patch_block_and_review_state_persist(self):
        block_id = "gold_demo_01_ch01_b007"
        response = self.client.patch(f"/api/projects/gold_demo_01/blocks/{block_id}", json={
            "clean_text": "An old inscription on the dial marked the passage of time.",
            "quality_flags": ["ok", "reviewed_edit"],
            "user": "tester",
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("block", response.get_json()["data"])

        review = self.client.patch(f"/api/projects/gold_demo_01/review/blocks/{block_id}", json={
            "reviewed": True,
            "reviewed_by": "tester",
            "user": "tester",
        })
        self.assertEqual(review.status_code, 200)
        self.assertTrue(review.get_json()["data"]["reviewed"])

        dataset = self.client.get("/api/projects/gold_demo_01/dataset").get_json()
        self.assertTrue(dataset["data"]["review_state"]["blocks"][block_id]["reviewed"])

    def test_add_glossary_from_selection_and_patch(self):
        block_id = "gold_demo_01_ch01_b007"
        text = "An old inscription on the dial marked the passage of time."
        start = text.index("dial")
        end = start + len("dial")
        response = self.client.post("/api/projects/gold_demo_01/glossary/from-selection", json={
            "block_id": block_id,
            "start": start,
            "end": end,
            "source_term": "dial",
            "expected_target": "mặt đồng hồ",
            "user": "tester",
        })
        self.assertEqual(response.status_code, 201)
        term = response.get_json()["data"]
        self.assertEqual(term["source_term"], "dial")

        patch = self.client.patch(f"/api/projects/gold_demo_01/glossary/{term['term_id']}", json={
            "status": "verified",
            "allowed_variants": ["mặt đồng hồ"],
            "user": "tester",
        })
        self.assertEqual(patch.status_code, 200)
        self.assertEqual(patch.get_json()["data"]["status"], "verified")

    def test_delete_locked_term_is_blocked(self):
        response = self.client.delete("/api/projects/gold_demo_01/glossary/g_001", json={"user": "tester"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["errors"][0]["code"], "locked_term")

    def test_add_entity_from_selection_and_patch(self):
        block_id = "gold_demo_01_ch01_b007"
        text = "An old inscription on the dial marked the passage of time."
        start = text.index("inscription")
        end = start + len("inscription")
        response = self.client.post("/api/projects/gold_demo_01/entities/from-selection", json={
            "block_id": block_id,
            "start": start,
            "end": end,
            "surface": "inscription",
            "canonical_target": "dòng khắc",
            "entity_type": "concept",
            "user": "tester",
        })
        self.assertEqual(response.status_code, 201)
        entity = response.get_json()["data"]
        self.assertEqual(entity["canonical_source"], "inscription")

        patch = self.client.patch(f"/api/projects/gold_demo_01/entities/{entity['entity_id']}", json={
            "aliases_target": ["dòng chữ khắc"],
            "pronoun_policy": "",
            "user": "tester",
        })
        self.assertEqual(patch.status_code, 200)
        self.assertEqual(patch.get_json()["data"]["aliases_target"], ["dòng chữ khắc"])

    def test_patch_summary(self):
        response = self.client.patch("/api/projects/gold_demo_01/summary/gold_demo_01_ch01", json={
            "summary_source": "Mira wakes before the Turning and asks about the slow dawn.",
            "source": "human",
            "user": "tester",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"]["source"], "human")

    def test_project_upload_extract_job_and_validate(self):
        doc_id = "phase3_txt"
        create = self.client.post("/api/projects", json={
            "doc_id": doc_id,
            "metadata": {
                "title": "Phase 3 TXT",
                "author": "Tester",
                "source_format": "txt",
                "license": "public-domain",
                "contamination_risk": "low",
            },
        })
        self.assertEqual(create.status_code, 201)

        upload = self.client.post(
            f"/api/projects/{doc_id}/source",
            data={"file": (BytesIO(b"Chapter 1\n\n\"Hello,\" Alice said.\n\nShe waited.\n\nChapter 2\n\nThe room was quiet."), "source.txt")},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 201)

        extract = self.client.post(f"/api/projects/{doc_id}/extract", json={"overwrite": False, "user": "tester"})
        self.assertEqual(extract.status_code, 201)
        job = extract.get_json()["data"]
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["document"]["chapters"], 2)

        job_status = self.client.get(f"/api/projects/{doc_id}/jobs/{job['job_id']}").get_json()
        self.assertEqual(job_status["data"]["status"], "done")

        validate = self.client.post(f"/api/projects/{doc_id}/validate").get_json()
        self.assertTrue(validate["data"]["ok"])

        blocked = self.client.post(f"/api/projects/{doc_id}/extract", json={"overwrite": False}).get_json()
        self.assertFalse(blocked["ok"])
        self.assertEqual(blocked["errors"][0]["code"], "confirm_overwrite_required")

    def test_epub_upload_extract_and_validate(self):
        doc_id = "phase3_epub"
        self.client.post("/api/projects", json={
            "doc_id": doc_id,
            "metadata": {
                "title": "Phase 3 EPUB",
                "author": "Tester",
                "source_format": "epub",
                "license": "public-domain",
                "contamination_risk": "low",
            },
        })
        epub = BytesIO()
        with ZipFile(epub, "w") as zf:
            zf.writestr("META-INF/container.xml", """<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""")
            zf.writestr("OPS/content.opf", """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>""")
            zf.writestr("OPS/c1.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>Chapter One</h1><p>Alice arrived.</p><p>"Hello," Bob said.</p>
</body></html>""")
        epub.seek(0)
        upload = self.client.post(
            f"/api/projects/{doc_id}/source",
            data={"file": (epub, "source.epub")},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 201)
        extract = self.client.post(f"/api/projects/{doc_id}/extract", json={"overwrite": False})
        self.assertEqual(extract.status_code, 201)
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        self.assertEqual(len(dataset["chapters"]), 1)
        self.assertTrue(any(block["block_type"] == "dialogue" for block in dataset["blocks"]))
        validate = self.client.post(f"/api/projects/{doc_id}/validate").get_json()
        self.assertTrue(validate["data"]["ok"])

    def test_pdf_upload_is_rejected(self):
        doc_id = "phase3_pdf"
        self.client.post("/api/projects", json={"doc_id": doc_id, "metadata": {"license": "public-domain", "contamination_risk": "low"}})
        upload = self.client.post(
            f"/api/projects/{doc_id}/source",
            data={"file": (BytesIO(b"%PDF-1.4"), "source.pdf")},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 400)
        self.assertIn("PDF logical extraction", upload.get_json()["errors"][0]["message"])

    def test_reference_lifecycle_and_freeze(self):
        doc_id = "phase4_freeze"
        self.client.post("/api/projects", json={
            "doc_id": doc_id,
            "metadata": {
                "title": "Phase 4 Freeze",
                "author": "Tester",
                "source_format": "txt",
                "license": "public-domain",
                "contamination_risk": "low",
            },
        })
        self.client.post(
            f"/api/projects/{doc_id}/source",
            data={"file": (BytesIO(b"Chapter 1\n\nAlice arrived.\n\n\"Good morning,\" Bob said."), "source.txt")},
            content_type="multipart/form-data",
        )
        self.client.post(f"/api/projects/{doc_id}/extract", json={"overwrite": False, "user": "tester"})

        blocked = self.client.post(f"/api/projects/{doc_id}/freeze", json={"user": "tester"})
        self.assertEqual(blocked.status_code, 409)
        reasons = blocked.get_json()["errors"][0]["reasons"]
        self.assertTrue(any("unreviewed" in reason for reason in reasons))

        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        for block in dataset["blocks"]:
            self.client.patch(f"/api/projects/{doc_id}/review/blocks/{block['block_id']}", json={
                "reviewed": True,
                "reviewed_by": "tester",
            })
        chapter_id = dataset["chapters"][0]["chapter_id"]
        self.client.patch(f"/api/projects/{doc_id}/summary/{chapter_id}", json={
            "summary_source": "Alice arrives and Bob greets her.",
            "source": "human",
        })
        block_id = next(block["block_id"] for block in dataset["blocks"] if block["block_type"] != "heading")
        draft = self.client.post(f"/api/projects/{doc_id}/references/draft", json={
            "block_id": block_id,
            "draft_vi": "Alice đến.",
            "source": "human",
            "translated_by": "translator_01",
        })
        self.assertEqual(draft.status_code, 201)
        reference_id = draft.get_json()["data"]["reference_id"]

        missing_source = self.client.post(f"/api/projects/{doc_id}/references/{reference_id}/review", json={
            "source": "",
            "reviewed_by": "reviewer_01",
        })
        self.assertEqual(missing_source.status_code, 400)

        reviewed = self.client.post(f"/api/projects/{doc_id}/references/{reference_id}/review", json={
            "source": "human",
            "reference_vi": "Alice đến.",
            "reviewed_by": "reviewer_01",
        })
        self.assertEqual(reviewed.status_code, 200)
        self.assertEqual(reviewed.get_json()["data"]["status"], "reviewed")

        locked = self.client.post(f"/api/projects/{doc_id}/references/{reference_id}/lock")
        self.assertEqual(locked.status_code, 200)
        self.assertEqual(locked.get_json()["data"]["status"], "locked")

        export = self.client.post(f"/api/projects/{doc_id}/export")
        self.assertEqual(export.status_code, 201)
        self.assertIn("zip", export.get_json()["data"])

        freeze = self.client.post(f"/api/projects/{doc_id}/freeze")
        self.assertEqual(freeze.status_code, 201)
        self.assertTrue(freeze.get_json()["data"]["frozen"])

    def test_freeze_is_blocked_by_draft_reference(self):
        doc_id = "phase4_draft"
        self.client.post("/api/projects", json={
            "doc_id": doc_id,
            "metadata": {
                "title": "Phase 4 Draft",
                "source_format": "txt",
                "license": "public-domain",
                "contamination_risk": "low",
            },
        })
        self.client.post(
            f"/api/projects/{doc_id}/source",
            data={"file": (BytesIO(b"Chapter 1\n\nAlice arrived."), "source.txt")},
            content_type="multipart/form-data",
        )
        self.client.post(f"/api/projects/{doc_id}/extract", json={"overwrite": False})
        dataset = self.client.get(f"/api/projects/{doc_id}/dataset").get_json()["data"]
        for block in dataset["blocks"]:
            self.client.patch(f"/api/projects/{doc_id}/review/blocks/{block['block_id']}", json={
                "reviewed": True,
                "reviewed_by": "tester",
            })
        self.client.patch(f"/api/projects/{doc_id}/summary/{dataset['chapters'][0]['chapter_id']}", json={
            "summary_source": "Alice arrives.",
            "source": "human",
        })
        block_id = next(block["block_id"] for block in dataset["blocks"] if block["block_type"] != "heading")
        self.client.post(f"/api/projects/{doc_id}/references/draft", json={
            "block_id": block_id,
            "draft_vi": "Alice đến.",
            "source": "human",
        })
        blocked = self.client.post(f"/api/projects/{doc_id}/freeze")
        self.assertEqual(blocked.status_code, 409)
        reasons = blocked.get_json()["errors"][0]["reasons"]
        self.assertTrue(any("draft reference" in reason for reason in reasons))


if __name__ == "__main__":
    unittest.main()
