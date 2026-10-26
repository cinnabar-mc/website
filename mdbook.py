#!/usr/bin/env python3
"""Install the pinned mdBook release binary after checking its archive hash."""

import hashlib
import io
from pathlib import Path
import platform
import subprocess
import tarfile
from urllib.request import urlopen


VERSION = "0.5.4"
DIRECTORY = Path(__file__).resolve().parent / ".tools" / ("mdbook-" + VERSION)
ARCHIVES = {
    ("Linux", "x86_64"): ("x86_64-unknown-linux-gnu", "3f28de05dafca9d0f2eab99c662116b0e37b89b1d96a08f8f430b9eeae958cd7"),
    ("Linux", "aarch64"): ("aarch64-unknown-linux-musl", "753e5c5c363ee8a56972344dcf91466f005a51db84a7aeffe427ae3ef83d6d44"),
    ("Darwin", "arm64"): ("aarch64-apple-darwin", "03e8a6d8b13a2971e0b3280affd03b388373c1485e26f73407c3a76b0b1838df"),
    ("Darwin", "x86_64"): ("x86_64-apple-darwin", "a47d7bf0d5d670cff9ee6cce95537cbeb62dc10704d9e7131ffbd13e2b59a5de"),
}


def binary():
    """Return the installed binary, rejecting a missing or different version."""
    executable = DIRECTORY / "mdbook"
    if not executable.is_file():
        raise RuntimeError("Install the pinned mdBook binary with python3 mdbook.py")
    if subprocess.check_output([str(executable), "--version"], text=True).strip() != "mdbook v" + VERSION:
        raise RuntimeError("Unexpected mdBook version; run python3 mdbook.py again")
    return executable


def install():
    """Download, verify, and install only the mdBook executable for this platform."""
    target, checksum = ARCHIVES[(platform.system(), platform.machine())]
    name = f"mdbook-v{VERSION}-{target}.tar.gz"
    url = f"https://github.com/rust-lang/mdBook/releases/download/v{VERSION}/{name}"
    with urlopen(url, timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != checksum:
        raise RuntimeError("mdBook archive SHA-256 does not match the pinned checksum")
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        executable = archive.extractfile("mdbook").read()
    temporary = DIRECTORY / "mdbook.download"
    temporary.write_bytes(executable)
    temporary.chmod(0o755)
    temporary.replace(DIRECTORY / "mdbook")
    binary()
    print(f"Installed mdbook v{VERSION} ({name}, SHA-256 {checksum})")


if __name__ == "__main__":
    install()
