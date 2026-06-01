import os
import sys
import tempfile
import unittest
from pathlib import Path


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

    def test_seed_project_and_dataset(self):
        projects = self.client.get("/api/projects").get_json()
        self.assertTrue(projects["ok"])
        self.assertEqual(projects["data"][0]["doc_id"], "gold_demo_01")

        dataset = self.client.get("/api/projects/gold_demo_01/dataset").get_json()
        self.assertTrue(dataset["ok"])
        self.assertEqual(len(dataset["data"]["blocks"]), 14)
        self.assertEqual(len(dataset["data"]["chapters"]), 2)

    def test_validate_project(self):
        response = self.client.post("/api/projects/gold_demo_01/validate")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["data"]["ok"])
        self.assertEqual(payload["data"]["exit_code"], 0)

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


if __name__ == "__main__":
    unittest.main()
