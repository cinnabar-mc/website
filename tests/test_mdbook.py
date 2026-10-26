"""Check that the mdBook installer rejects unverified download content."""

import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import mdbook


class MdbookTests(unittest.TestCase):
    def test_checksum_failure_does_not_install_an_executable(self):
        """Reject corrupted archive bytes before extracting or replacing the binary."""
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "tools"
            with patch.object(mdbook, "DIRECTORY", directory), patch.object(
                mdbook.platform, "system", return_value="Linux"
            ), patch.object(mdbook.platform, "machine", return_value="x86_64"), patch.object(
                mdbook, "urlopen", return_value=io.BytesIO(b"invalid archive")
            ):
                with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                    mdbook.install()
            self.assertFalse(directory.exists())
