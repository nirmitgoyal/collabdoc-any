import subprocess
import sys
import unittest
from pathlib import Path


class DemoTests(unittest.TestCase):
    def test_transcript(self):
        run = subprocess.run(
            [sys.executable, "demo.py"],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True, text=True, check=True,
        )
        self.assertEqual(run.stdout.splitlines(), [
            "Alice local: AxB", "Bob local: AyB",
            "Alice after x,y,y: AxyB", "Bob after y,x,x: AxyB",
            "Final agreement: AxyB",
        ])
