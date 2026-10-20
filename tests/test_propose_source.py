"""Exercise proposal recovery after a branch push succeeds but PR creation fails."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import propose_source
import source


class ProposalTests(unittest.TestCase):
    def test_retry_reuses_the_pushed_commit_without_rewriting_remote_history(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            origin = root / "origin.git"
            checkout = root / "website"
            subprocess.run(["git", "init", "--quiet", "--bare", str(origin)], check=True)
            checkout.mkdir()
            source.git(checkout, "init", "--quiet", "-b", "main")
            source.git(checkout, "config", "user.name", "Fixture")
            source.git(checkout, "config", "user.email", "fixture@example.invalid")
            source.git(checkout, "remote", "add", "origin", str(origin))
            config = {"revision": "1" * 40}
            pin = checkout / "source.json"
            pin.write_text(json.dumps({"revision": "0" * 40}))
            source.git(checkout, "add", ".")
            source.git(checkout, "commit", "--quiet", "-m", "Initial site")
            pin.write_text(json.dumps(config))
            branch = "automation/client-inputs-" + config["revision"]
            real_run = subprocess.run
            attempted_prs = []
            dispatches = []

            def command(arguments, **kwargs):
                """Use real local Git and fail the first external PR creation."""
                if arguments[0] != "gh":
                    return real_run(arguments, **kwargs)
                if arguments[1:3] == ("pr", "create"):
                    attempted_prs.append(arguments)
                    if len(attempted_prs) == 1:
                        raise subprocess.CalledProcessError(1, arguments)
                else:
                    dispatches.append(arguments)
                return subprocess.CompletedProcess(arguments, 0)

            with patch.object(propose_source, "HERE", checkout), patch.object(
                propose_source, "load_config", return_value=config
            ), patch.object(propose_source.subprocess, "run", side_effect=command):
                with self.assertRaises(subprocess.CalledProcessError):
                    propose_source.propose()
                pushed = source.git(origin, "rev-parse", "refs/heads/" + branch)
                source.git(checkout, "switch", "main")
                pin.write_text(json.dumps(config))
                propose_source.propose()
                self.assertEqual(source.git(origin, "rev-parse", "refs/heads/" + branch), pushed)
                self.assertEqual(json.loads(pin.read_text()), config)
                self.assertEqual(len(attempted_prs), 2)
                self.assertEqual(len(dispatches), 1)
