"""Check that source updates preserve reproducibility without following unrelated changes."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import source


class SourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.checkout = self.root / "client"
        self.checkout.mkdir()
        source.git(self.checkout, "init", "--quiet")
        source.git(self.checkout, "config", "user.name", "Fixture")
        source.git(self.checkout, "config", "user.email", "fixture@example.invalid")
        (self.checkout / "manifest.json").write_text('{"asset": "original"}\n')
        chapter = self.checkout / "docs/modding/src/guides/start.md"
        chapter.parent.mkdir(parents=True)
        chapter.write_text("# Getting started\n")
        self.commit("Initial inputs")
        self.config = {
            "repository": "fixture/client", "branch": "dev",
            "revision": source.git(self.checkout, "rev-parse", "HEAD"),
            "inputs": {"manifest": "manifest.json", "modding": "docs/modding"},
        }
        self.path = self.root / "source.json"
        self.path.write_text(json.dumps(self.config) + "\n")

    def commit(self, message):
        """Create a fixture revision with all current file changes."""
        source.git(self.checkout, "add", ".")
        source.git(self.checkout, "commit", "--quiet", "-m", message)

    def update(self):
        """Compare fixture commits while replacing only remote fetches."""
        latest = source.git(self.checkout, "rev-parse", "HEAD")
        with patch.object(source, "fetch", side_effect=[self.config["revision"], latest]):
            return source.update_source(self.config, self.checkout, self.path)

    def test_unrelated_client_changes_keep_the_pin(self):
        before = self.path.read_bytes()
        (self.checkout / "client.rs").write_text("// Unrelated client code\n")
        self.commit("Change client code")
        self.assertFalse(self.update())
        self.assertEqual(self.path.read_bytes(), before)

    def test_changed_input_advances_pin_and_materializes_new_content(self):
        (self.checkout / "manifest.json").write_text('{"asset": "updated"}\n')
        self.commit("Change release inputs")
        latest = source.git(self.checkout, "rev-parse", "HEAD")
        self.assertTrue(self.update())
        self.assertEqual(source.load_config(self.path)["revision"], latest)
        self.assertEqual(source.git(self.checkout, "rev-parse", "HEAD"), latest)
        self.assertIn("updated", (self.checkout / "manifest.json").read_text())

    def test_missing_input_is_proposed_for_validation_instead_of_silently_ignored(self):
        (self.checkout / "manifest.json").unlink()
        self.commit("Remove release input")
        self.assertTrue(self.update())
        self.assertFalse((self.checkout / "manifest.json").exists())

    def test_fetch_materializes_the_pin_instead_of_latest(self):
        pinned = self.config["revision"]
        (self.checkout / "manifest.json").write_text("changed\n")
        self.commit("Change upstream")
        with patch.object(source, "fetch", return_value=pinned) as fetch:
            source.checkout_source(self.config, self.checkout)
        fetch.assert_called_once_with(self.config, self.checkout, pinned)
        self.assertEqual(source.git(self.checkout, "rev-parse", "HEAD"), pinned)
        self.assertIn("original", (self.checkout / "manifest.json").read_text())

    def test_sparse_fetch_includes_nested_directory_inputs_only(self):
        """Fetch real fixture commits through the production sparse checkout path."""
        (self.checkout / "docs/unrelated").mkdir()
        (self.checkout / "docs/unrelated/private.md").write_text("Not a site input\n")
        self.commit("Add unrelated documentation")
        self.config["revision"] = source.git(self.checkout, "rev-parse", "HEAD")
        sparse = self.root / "sparse"
        real_git = source.git

        def local_remote(checkout, *arguments):
            """Replace GitHub with the local fixture while using real Git commands."""
            if arguments[:2] in {("remote", "add"), ("remote", "set-url")}:
                arguments = (*arguments[:-1], self.checkout.as_uri())
            return real_git(checkout, *arguments)

        with patch.object(source, "git", side_effect=local_remote):
            source.checkout_source(self.config, sparse)
        self.assertEqual((sparse / "docs/modding/src/guides/start.md").read_text(),
                         "# Getting started\n")
        self.assertTrue((sparse / "manifest.json").is_file())
        self.assertFalse((sparse / "docs/unrelated").exists())

    def test_nested_directory_edits_additions_renames_and_deletions_advance_pin(self):
        """Detect every kind of nested change to a declared directory input."""
        chapter = self.checkout / "docs/modding/src/guides/start.md"
        chapter.write_text("# Updated guide\n")
        self.commit("Edit nested chapter")
        self.assertTrue(self.update())
        addition = chapter.with_name("new.md")
        addition.write_text("# Another chapter\n")
        self.commit("Add nested chapter")
        self.assertTrue(self.update())
        renamed = addition.with_name("renamed.md")
        addition.rename(renamed)
        self.commit("Rename nested chapter")
        self.assertTrue(self.update())
        renamed.unlink()
        self.commit("Delete nested chapter")
        self.assertTrue(self.update())

    def test_comparison_error_does_not_advance_the_pin(self):
        before = self.path.read_bytes()
        with patch.object(source, "fetch", return_value=self.config["revision"]), patch.object(
            source.subprocess, "run", return_value=subprocess.CompletedProcess([], 128)
        ), patch.object(source, "checkout_source"):
            with self.assertRaisesRegex(RuntimeError, "compare"):
                source.update_source(self.config, self.checkout, self.path)
        self.assertEqual(self.path.read_bytes(), before)

    def test_moving_refs_and_paths_outside_checkout_are_rejected(self):
        for key, value in (("revision", "dev"), ("inputs", {"manifest": "../secret"})):
            with self.subTest(key=key):
                invalid = dict(self.config, **{key: value})
                self.path.write_text(json.dumps(invalid))
                with self.assertRaises(ValueError):
                    source.load_config(self.path)
