# Cinnabar website

The official Cinnabar landing page, deployed as a Cloudflare static-assets Worker.
Client releases and downloads remain in [cinnabar-mc/cinnabar](https://github.com/cinnabar-mc/cinnabar).
The site was extracted from that repository at
[`e33610ed`](https://github.com/cinnabar-mc/cinnabar/tree/e33610ed1b24d9a219d7e4a93936bd9c72a3b1fd/website)
and retains its [PolyForm Noncommercial license](LICENSE).

## Build and test

Requires Python 3.11+, Node.js 22+, Git, and the pinned mdBook binary. No Rust or
game assets are needed.

```sh
python3 mdbook.py
python3 source.py fetch
python3 render.py
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

`dist/` contains generated files. `source.json` pins a full client commit and
names the release manifest, API contract, branding and modding book used by the renderer.
`source.py fetch` materializes only those files and directories in the ignored `.source/` checkout.
To render against another local client checkout, use `python3 render.py --source PATH`.

`mdbook.py` downloads mdBook 0.5.4 from its release archives, verifies the pinned
SHA-256 for the current platform, and installs it in the ignored `.tools/` directory.
Both build workflows use the same installer. It supports Linux and macOS on
x86-64 and ARM64. The renderer builds the book at `dist/docs/modding/`, applying
the website's `docs-theme/` overrides to a temporary copy of the book.

The landing page and book share `site-header.html.in` and `site-header.css`.
The book places its sidebar and search controls in that header row, marks Docs
as the current page, and uses a dark theme without theme or print controls.
Sidebar chapter numbers are disabled; upstream chapter titles are preserved.

The hourly Update client inputs workflow checks the client's `dev` branch. It
opens a tested PR changing the pin only when one of the declared inputs changes;
unrelated client commits leave the pin alone. One input-update PR stays open at a
time. After the Website workflow verifies the exact branch head, the Merge client
inputs workflow squash-merges same-repository automation PRs targeting `main` that
modify only `source.json`. It dispatches Website on `main` to deploy the merged
pin, then deletes the automation branch. Human PRs keep their usual review path.
To check manually:

```sh
python3 mdbook.py
python3 source.py update
python3 render.py
```

## Deploy

The Website workflow tests every PR and validates the pinned Wrangler version
with a dry run. Pushes to `main` deploy after verification; manual dispatch deploys
only when run on `main`. The workflow follows redirects and byte-compares every
published file with the build. Other branches can validate without deploying.

The `website` GitHub environment supplies the `CLOUDFLARE_API_TOKEN` secret and
`CLOUDFLARE_ACCOUNT_ID` variable. `wrangler.jsonc` identifies the existing Worker
and account, serves `dist/` without a Worker script, and disables request logs.
The input-update workflow needs Actions permission to create pull requests and
dispatch the Website workflow, because token-created PRs do not trigger CI.

The `RestartFU/configurations` repository owns the custom domain's Caddy proxy.
It forwards requests to the Worker over HTTPS while preserving the public domain,
path and query string. Moving this repository does not require a hosting or DNS
change. The workflow's `WEBSITE_URL` selects the post-deploy verification target.

Static assets use `auto-trailing-slash`: `/docs/modding/` serves the book's
`index.html`, and nested chapter paths serve their matching HTML files. Requests
for `.html` pages redirect to the clean URL. With `404-page`, missing book paths
return the book's generated `404.html` with status 404; other missing paths return
a normal 404. No route falls back to the landing page.

## Player presence

The activity section also shows unique Cinnabar users since tracking began, from
`GET /v1/users/count` (`{"unique":0}`). This counts verified accounts once across
reconnects and devices, including accounts with presence visibility off. The API
retains salted account digests and publishes only the total. Tracking starts at
API deployment with no historical backfill; existing sessions count on their next
successful login. Deploy that endpoint before the website to enable this count.
It polls independently once per visible minute with the same timeout and failure
handling as the online count; a missing endpoint leaves just this count empty.

The player activity section shows unique connected, visible Cinnabar accounts
from `GET /v1/presence/count`. The API origin comes from the shared bridge contract.
It refreshes once per minute while the page is visible, bypassing the browser cache,
with a five-second request timeout. Failed or invalid responses clear the count; background tabs stop polling.
Deploy the API endpoint before the website to enable the count.

The player chart reads `GET /v1/presence/history?range=24h|7d|30d` from the same
origin. The API collects one anonymous count per minute independently of website
visits. The 7-day and 30-day views show ten-minute and hourly averages, with peaks
and averages calculated from observed minutes only. Missing buckets appear as
gaps; recorded zeroes sit on the baseline. History starts when the API collector
is deployed, without backfilled estimates.

The chart refreshes every minute while visible and bypasses the browser cache
on each request. The API's shared cache still limits upstream reads to once per
minute. Range changes cancel older requests; empty history and errors have
explicit messages. Hover or touch the plot to inspect a sample, or focus it and
use the arrow, Home and End keys.
