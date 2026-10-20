# Website agent instructions

This repository owns the Cinnabar website and its deployment. Client behavior,
release filenames, API origin, and shared branding belong in the client repository.
Read shared inputs through `source.json`; do not maintain duplicate snapshots.
Keep the existing license and attribution when moving or modifying files.

Run `python3 source.py fetch`, `python3 render.py`, the JavaScript tests and the
Python tests described in README.md before opening a PR into `main`. Include a
regression test for behavior changes. Changes that only move files must preserve
the generated output. Only `main` deploys; other refs may validate.

Keep secrets in GitHub's `website` environment. Never commit credentials, generated
`dist/`, `.source/`, or Wrangler state. Use imperative PR titles and exactly one
of `new`, `fix`, `performance`, or `internal`. Review executable changes before
merging. Keep agent reports in the configured private checkout.
