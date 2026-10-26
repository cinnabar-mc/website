"""Check the validation boundary and recovery path for automatic input merges."""

import copy
import json
import subprocess
import unittest
from unittest.mock import call, patch

import merge_source


REPOSITORY = "fixture/website"
ROOT = f"repos/{REPOSITORY}"
SHA = "1" * 40
BRANCH = merge_source.BRANCH_PREFIX + SHA
RUN = {
    "id": 123, "run_attempt": 2, "event": "workflow_dispatch", "conclusion": "success",
    "path": ".github/workflows/website.yml", "head_repository": {"full_name": REPOSITORY},
    "head_branch": BRANCH, "head_sha": SHA,
}
REQUEST = {
    "number": 42, "state": "open", "merged": False, "changed_files": 1,
    "title": "Update shared client inputs",
    "head": {"ref": BRANCH, "sha": SHA, "repo": {"full_name": REPOSITORY}},
    "base": {"ref": "main", "repo": {"full_name": REPOSITORY}},
}
FILES = [{"filename": "source.json", "status": "modified"}]
JOB = {"name": "verify", "conclusion": "success", "head_sha": SHA}
REFS = [{"ref": "refs/heads/" + BRANCH, "object": {"sha": SHA}}]


def responses(*, request=None, files=None, jobs=None, result=None, refs=None):
    """Build the API responses for a validation attempt followed by one matching PR."""
    request = REQUEST if request is None else request
    return [
        [{"jobs": [JOB]}] if jobs is None else jobs,
        [[], [{"number": 42}]], request,
        [[], FILES] if files is None else files,
        request,
        {"merged": True} if result is None else result,
        None,
        REFS if refs is None else refs,
        None,
    ]


class MergeGuardTests(unittest.TestCase):
    def test_only_successful_local_website_dispatches_can_reach_the_api(self):
        for key, value in (
            ("event", "pull_request"), ("event", "push"),
            ("conclusion", "failure"), ("conclusion", "cancelled"),
            ("conclusion", "skipped"), ("path", ".github/workflows/other.yml"),
            ("head_repository", {"full_name": "fork/website"}),
            ("head_branch", "main"), ("head_branch", "feature/client-inputs-" + SHA),
        ):
            with self.subTest(key=key, value=value):
                run = {**RUN, key: value}
                with patch.object(merge_source, "api") as api:
                    merge_source.merge_validated(run, REPOSITORY)
                    api.assert_not_called()

    def test_pr_guards_reject_other_branches_repositories_targets_and_heads(self):
        for section, key, value in (
            ("head", "ref", "feature/input-update"),
            ("head", "ref", BRANCH + "-other"),
            ("head", "sha", "2" * 40),
            ("head", "repo", {"full_name": "fork/website"}),
            ("head", "repo", None),
            ("base", "ref", "dev"),
            ("base", "repo", {"full_name": "other/website"}),
            (None, "changed_files", 2), (None, "state", "closed"),
        ):
            with self.subTest(section=section, key=key, value=value):
                request = copy.deepcopy(REQUEST)
                (request[section] if section else request)[key] = value
                with patch.object(merge_source, "api", side_effect=responses(request=request)) as api:
                    merge_source.merge_validated(RUN, REPOSITORY)
                    self.assertEqual(api.call_count, 3)

    def test_only_a_modified_source_json_is_allowed(self):
        for files in (
            [], FILES + [{"filename": "app.js", "status": "modified"}],
            [{"filename": "nested/source.json", "status": "modified"}],
            [{"filename": "app.js", "status": "modified"}],
            [{"filename": "source.json", "status": "added"}],
            [{"filename": "source.json", "status": "removed"}],
            [{"filename": "source.json", "status": "renamed", "previous_filename": "app.js"}],
            [{**FILES[0], "previous_filename": "app.js"}],
        ):
            with self.subTest(files=files):
                with patch.object(merge_source, "api", side_effect=responses(files=[files])) as api:
                    merge_source.merge_validated(RUN, REPOSITORY)
                    self.assertEqual(api.call_count, 4)
        self.assertTrue(merge_source.source_only(FILES))

    def test_verify_must_succeed_for_the_same_sha_in_this_attempt(self):
        for jobs in ([], [{**JOB, "name": "other"}], [{**JOB, "conclusion": "skipped"}],
                     [{**JOB, "conclusion": "failure"}], [{**JOB, "head_sha": "2" * 40}]):
            with self.subTest(jobs=jobs):
                with patch.object(merge_source, "api", return_value=[{"jobs": jobs}]) as api:
                    merge_source.merge_validated(RUN, REPOSITORY)
                    api.assert_called_once_with(
                        f"{ROOT}/actions/runs/123/attempts/2/jobs?per_page=100", paginate=True,
                    )

    def test_merge_squashes_the_validated_head_then_dispatches_main_before_deleting(self):
        replies = responses(jobs=[{"jobs": []}, {"jobs": [JOB]}])
        with patch.object(merge_source, "api", side_effect=replies) as api:
            merge_source.merge_validated(RUN, REPOSITORY)
            self.assertEqual(api.call_args_list[-4:], [
                call(f"{ROOT}/pulls/42/merge", method="PUT", data={
                    "sha": SHA, "merge_method": "squash", "commit_title": REQUEST["title"],
                }),
                call(f"{ROOT}/actions/workflows/website.yml/dispatches", method="POST",
                     data={"ref": "main"}),
                call(f"{ROOT}/git/matching-refs/heads/automation%2Fclient-inputs-{SHA}"),
                call(f"{ROOT}/git/refs/heads/automation%2Fclient-inputs-{SHA}", method="DELETE"),
            ])

    def test_metadata_is_rechecked_after_reading_the_file_list(self):
        for section, key, value in (
            ("head", "sha", "2" * 40), ("base", "ref", "dev"),
            (None, "changed_files", 2),
        ):
            with self.subTest(key=key):
                changed = copy.deepcopy(REQUEST)
                (changed[section] if section else changed)[key] = value
                replies = responses()
                replies[4] = changed
                with patch.object(merge_source, "api", side_effect=replies) as api:
                    merge_source.merge_validated(RUN, REPOSITORY)
                    self.assertEqual(api.call_count, 5)

    def test_an_atomic_sha_conflict_cannot_dispatch_or_delete(self):
        replies = responses()
        replies[5] = subprocess.CalledProcessError(1, "gh api")
        with patch.object(merge_source, "api", side_effect=replies) as api:
            with self.assertRaises(subprocess.CalledProcessError):
                merge_source.merge_validated(RUN, REPOSITORY)
            self.assertEqual(api.call_count, 6)

    def test_unconfirmed_merge_cannot_dispatch_or_delete(self):
        with patch.object(merge_source, "api", side_effect=responses(result={"merged": False})) as api:
            with self.assertRaises(RuntimeError):
                merge_source.merge_validated(RUN, REPOSITORY)
            self.assertEqual(api.call_count, 6)

    def test_failed_dispatch_leaves_the_branch_for_a_retry(self):
        replies = responses()
        replies[6] = subprocess.CalledProcessError(1, "gh api")
        with patch.object(merge_source, "api", side_effect=replies) as api:
            with self.assertRaises(subprocess.CalledProcessError):
                merge_source.merge_validated(RUN, REPOSITORY)
            self.assertEqual(api.call_count, 7)

    def test_rerun_recovers_dispatch_after_a_confirmed_merge(self):
        request = {**REQUEST, "state": "closed", "merged": True}
        replies = responses(request=request)
        del replies[5]
        with patch.object(merge_source, "api", side_effect=replies) as api:
            merge_source.merge_validated(RUN, REPOSITORY)
            self.assertFalse(any(c.kwargs.get("method") == "PUT" for c in api.call_args_list))
            self.assertIn(call(f"{ROOT}/actions/workflows/website.yml/dispatches", method="POST",
                               data={"ref": "main"}), api.call_args_list)
            self.assertEqual(api.call_args.kwargs, {"method": "DELETE"})

    def test_branch_cleanup_preserves_a_new_head_or_an_already_deleted_branch(self):
        for refs in ([], [{**REFS[0], "object": {"sha": "2" * 40}}],
                     [{**REFS[0], "ref": "refs/heads/" + BRANCH + "-other"}]):
            with self.subTest(refs=refs):
                with patch.object(merge_source, "api", side_effect=responses(refs=refs)) as api:
                    merge_source.merge_validated(RUN, REPOSITORY)
                    self.assertEqual(api.call_count, 8)

    def test_api_passes_title_as_json_and_handles_empty_dispatch_responses(self):
        title = "Update `literal` $(title)\nwith a second line"
        with patch.object(merge_source.subprocess, "run", return_value=
                          subprocess.CompletedProcess([], 0, "")) as run:
            self.assertIsNone(merge_source.api("repos/fixture/website/pulls/42/merge",
                                              method="PUT", data={"commit_title": title}))
            self.assertEqual(json.loads(run.call_args.kwargs["input"]), {"commit_title": title})
            self.assertNotIn("shell", run.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
