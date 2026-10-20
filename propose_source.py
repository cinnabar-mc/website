#!/usr/bin/env python3
"""Open a reviewed update to shared client inputs from the scheduled workflow."""

import argparse
import json
import subprocess

from source import HERE, load_config

BRANCH_PREFIX = "automation/client-inputs-"


def pending_branch(pull_requests):
    """Select an input-update PR from this repository targeting main, excluding forks."""
    return next((
        pr["headRefName"] for pr in pull_requests
        if not pr["isCrossRepository"] and pr["baseRefName"] == "main"
        and pr["headRefName"].startswith(BRANCH_PREFIX)
    ), "")


def run(*arguments):
    """Run an automation command from the website repository."""
    subprocess.run(arguments, cwd=HERE, check=True)


def propose():
    """Create an input PR, reusing its remote branch after an interrupted attempt."""
    branch = BRANCH_PREFIX + load_config()["revision"]
    remote = subprocess.run(
        ["git", "ls-remote", "--exit-code", "--heads", "origin", "refs/heads/" + branch],
        cwd=HERE, check=False, capture_output=True,
    )
    if remote.returncode == 0:
        proposed = (HERE / "source.json").read_bytes()
        run("git", "fetch", "origin", "refs/heads/" + branch)
        run("git", "restore", "--", "source.json")
        run("git", "switch", "-C", branch, "FETCH_HEAD")
        (HERE / "source.json").write_bytes(proposed)
    elif remote.returncode == 2:
        run("git", "switch", "-c", branch)
    else:
        raise RuntimeError("could not check the existing proposal branch")
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "add", "source.json")
    difference = subprocess.run(
        ["git", "diff", "--cached", "--quiet"], cwd=HERE, check=False
    ).returncode
    if difference == 1:
        run("git", "commit", "-m", "Update shared client inputs")
    elif difference != 0:
        raise RuntimeError("could not compare the proposed input pin")
    run("git", "push", "origin", branch)
    run("gh", "pr", "create", "--base", "main", "--head", branch,
        "--title", "Update shared client inputs", "--body-file", ".github/source-update.md",
        "--label", "internal")
    # Token-created PRs do not trigger pull_request workflows.
    run("gh", "workflow", "run", "website.yml", "--ref", branch)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("pending", "create"), nargs="?", default="create")
    args = parser.parse_args()
    if args.command == "pending":
        requests = subprocess.check_output(
            ["gh", "pr", "list", "--state", "open", "--base", "main", "--limit", "1000",
             "--json", "headRefName,isCrossRepository,baseRefName"], cwd=HERE, text=True,
        )
        print(pending_branch(json.loads(requests)))
    else:
        propose()
