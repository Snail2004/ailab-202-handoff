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


if __name__ == "__main__":
    unittest.main()
