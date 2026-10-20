#!/usr/bin/env python3
"""Fetch pinned client inputs or advance the pin when those inputs change."""

import argparse
import json
from pathlib import Path, PurePosixPath
import re
import subprocess


HERE = Path(__file__).resolve().parent
CONFIG = HERE / "source.json"
CHECKOUT = HERE / ".source"


def load_config(path=CONFIG):
    """Read a full commit pin and repository-relative input paths."""
    config = json.loads(path.read_text())
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", config["repository"]):
        raise ValueError("source repository must be a GitHub owner/repository")
    if not re.fullmatch(r"[0-9a-f]{40}", config["revision"]):
        raise ValueError("source revision must be a full commit SHA")
    for value in config["inputs"].values():
        relative = PurePosixPath(value)
        if relative.is_absolute() or any(part in {"..", ".git"} for part in relative.parts):
            raise ValueError("source inputs must stay within the checkout")
    return config


def git(checkout, *arguments):
    """Run Git in a dedicated source checkout and return its trimmed output."""
    return subprocess.check_output(
        ["git", "-C", str(checkout), *arguments], text=True
    ).strip()


def fetch(config, checkout, revision):
    """Fetch a client revision into a sparse checkout containing only site inputs."""
    if not (checkout / ".git").exists():
        checkout.mkdir(parents=True, exist_ok=True)
        git(checkout, "init", "--quiet")
        git(checkout, "remote", "add", "origin", "https://github.com/" + config["repository"] + ".git")
    git(checkout, "remote", "set-url", "origin", "https://github.com/" + config["repository"] + ".git")
    git(checkout, "sparse-checkout", "set", "--no-cone",
        *("/" + path for path in config["inputs"].values()))
    git(checkout, "fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", revision)
    return git(checkout, "rev-parse", "FETCH_HEAD")


def checkout_source(config, checkout=CHECKOUT):
    """Materialize the exact pinned commit without following the moving branch."""
    revision = fetch(config, checkout, config["revision"])
    git(checkout, "checkout", "--quiet", "--detach", revision)


def update_source(config, checkout=CHECKOUT, path=CONFIG):
    """Advance the pin only if a declared input differs from the upstream branch."""
    checkout_source(config, checkout)
    revision = fetch(config, checkout, "refs/heads/" + config["branch"])
    difference = subprocess.run(
        ["git", "-C", str(checkout), "diff", "--quiet", config["revision"], revision,
         "--", *config["inputs"].values()], check=False
    ).returncode
    if difference == 0:
        return False
    if difference != 1:
        raise RuntimeError("could not compare source inputs")
    config["revision"] = revision
    path.write_text(json.dumps(config, indent=2) + "\n")
    git(checkout, "checkout", "--quiet", "--detach", revision)
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("fetch", "update"))
    args = parser.parse_args()
    config = load_config()
    if args.command == "fetch":
        checkout_source(config)
    else:
        update_source(config)
