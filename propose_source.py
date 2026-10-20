#!/usr/bin/env python3
"""Open a reviewed update to shared client inputs from the scheduled workflow."""

import subprocess

from source import HERE, load_config


def run(*arguments):
    """Run an automation command from the website repository."""
    subprocess.run(arguments, cwd=HERE, check=True)


if __name__ == "__main__":
    branch = "automation/client-inputs-" + load_config()["revision"]
    run("git", "switch", "-c", branch)
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "add", "source.json")
    run("git", "commit", "-m", "Update shared client inputs")
    run("git", "push", "origin", branch)
    run("gh", "pr", "create", "--base", "dev", "--head", branch,
        "--title", "Update shared client inputs", "--body-file", ".github/source-update.md",
        "--label", "internal")
    # Token-created PRs do not trigger pull_request workflows.
    run("gh", "workflow", "run", "website.yml", "--ref", branch)
