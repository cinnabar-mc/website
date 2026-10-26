#!/usr/bin/env python3
"""Merge a source pin after the Website workflow validates its exact head."""

import json
import os
from pathlib import Path
import subprocess
from urllib.parse import quote, urlencode

from propose_source import BRANCH_PREFIX


def api(path, *, method="GET", data=None, paginate=False):
    """Call the GitHub API without interpreting request data as shell commands."""
    command = ["gh", "api", "--method", method, path]
    if paginate:
        command.extend(["--paginate", "--slurp"])
    if data is not None:
        command.extend(["--input", "-"])
    result = subprocess.run(
        command, input=json.dumps(data) if data is not None else None,
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout) if result.stdout.strip() else None


def validated_run(run, repository):
    """Accept only successful Website dispatches of this repository's input branches."""
    return (
        run["event"] == "workflow_dispatch"
        and run["conclusion"] == "success"
        and run["path"] == ".github/workflows/website.yml"
        and run["head_repository"]["full_name"] == repository
        and run["head_branch"].startswith(BRANCH_PREFIX)
    )


def eligible_pull_request(request, run, repository):
    """Require the validated head, the local main target, and a single changed file."""
    return (
        request["head"]["repo"] is not None
        and request["head"]["repo"]["full_name"] == repository
        and request["base"]["repo"]["full_name"] == repository
        and request["base"]["ref"] == "main"
        and request["head"]["ref"] == run["head_branch"]
        and request["head"]["ref"].startswith(BRANCH_PREFIX)
        and request["head"]["sha"] == run["head_sha"]
        and request["changed_files"] == 1
        and (request["state"] == "open" or request["merged"])
    )


def source_only(files):
    """Allow one modified source pin, rejecting additions, deletions and renames."""
    return (len(files) == 1 and files[0]["filename"] == "source.json"
            and files[0]["status"] == "modified" and "previous_filename" not in files[0])


def merge_validated(run, repository):
    """Check the run and PR, squash its pinned head, then dispatch main and clean up."""
    if not validated_run(run, repository):
        return
    root = f"repos/{repository}"
    pages = api(
        f'{root}/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs?per_page=100',
        paginate=True,
    )
    if not any(job["name"] == "verify" and job["conclusion"] == "success"
               and job["head_sha"] == run["head_sha"]
               for page in pages for job in page["jobs"]):
        return
    query = urlencode({"state": "all", "base": "main", "per_page": 100,
                       "head": repository.split("/")[0] + ":" + run["head_branch"]})
    candidates = api(f"{root}/pulls?{query}", paginate=True)
    for candidate in (request for page in candidates for request in page):
        path = f'{root}/pulls/{candidate["number"]}'
        request = api(path)
        if not eligible_pull_request(request, run, repository):
            continue
        files = [file for page in api(f"{path}/files?per_page=100", paginate=True)
                 for file in page]
        if not source_only(files):
            continue
        # Recheck metadata after listing files; the merge API also locks the head SHA.
        request = api(path)
        if not eligible_pull_request(request, run, repository):
            continue
        if not request["merged"]:
            result = api(f"{path}/merge", method="PUT", data={
                "sha": run["head_sha"], "merge_method": "squash",
                "commit_title": request["title"],
            })
            if not result["merged"]:
                raise RuntimeError("GitHub did not confirm the input PR merge")
        # Include merged PRs above so a rerun can recover a failed dispatch.
        api(f"{root}/actions/workflows/website.yml/dispatches", method="POST",
            data={"ref": "main"})
        branch = run["head_branch"]
        refs = api(f'{root}/git/matching-refs/heads/{quote(branch, safe="")}')
        if any(ref["ref"] == "refs/heads/" + branch
               and ref["object"]["sha"] == run["head_sha"] for ref in refs):
            api(f'{root}/git/refs/heads/{quote(branch, safe="")}', method="DELETE")
        return


if __name__ == "__main__":
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    merge_validated(event["workflow_run"], os.environ["GITHUB_REPOSITORY"])
