import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from config import SCHEMA_DIR, VALIDATOR_SCRIPT


def run_validator(dataset_dir: Path, schema_dir: Path = SCHEMA_DIR) -> dict[str, Any]:
    cmd = [
        sys.executable,
        str(VALIDATOR_SCRIPT),
        "--dataset",
        str(dataset_dir),
        "--schema",
        str(schema_dir),
        "--json",
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    try:
        report = json.loads(proc.stdout)
    except json.JSONDecodeError:
        report = {
            "ok": False,
            "dataset": str(dataset_dir),
            "counts": {},
            "errors": [{
                "file": "-",
                "location": "-",
                "message": "Validator did not return valid JSON.",
                "severity": "error",
            }],
            "warnings": [],
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }

    report["exit_code"] = proc.returncode
    if proc.stderr and "stderr" not in report:
        report["stderr"] = proc.stderr
    return report
