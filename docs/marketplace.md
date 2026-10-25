# Marketplace implementation boundary

The website combines category/library workflows with permission-aware review and
an HTTP adapter targeting the real API by default. An explicit
`render.py --marketplace-backend mock` build retains the labelled local preview. The
canonical entry is `/mods/`; `/marketplace/` serves the same hash application.
No SPA fallback or dynamic Worker is required.

## Website behavior

- Search/filter state survives a project visit. The library belongs to the chosen
  account; unavailable selections remain visible and removable in both backends.
  Adding a mod never grants runtime permissions or installs code.
- Library removal sends the displayed selection's hash and send timestamp. A stale
  selection refreshes before another attempt; errors leave removal retryable.
  Opening the library refreshes its account and selections. Pending removals cannot
  replace a later route or account. Installed mods are managed in Cinnabar.
- Descriptions support Markdown headings, lists, emphasis, code and HTTPS links,
  rendered as DOM nodes. Creator HTML is plain text. Images accept raster data
  in local drafts or API-derived HTTPS URLs; captions and alt text are plain text.
- Project → Images → Release → Checks & publish keeps a browser-local draft per
  account. Image inputs are limited to 8 MiB and 24 megapixels, resized to at most
  1600 pixels and re-encoded as WebP. Live uploads allow four prepared images, each
  below the API's 1 MiB limit; the local preview allows twelve. Draft image data is
  capped at 2 MiB. Component bytes are never saved in browser storage.
- Strict metadata checks enforce the whole component header, known section IDs,
  section-local bounds, bounded u32 lengths, UTF-8 and unique declarations/grants.
  The pinned Jco parser checks component structure/types and guest bytecode in a
  disposable worker with a 20-second deadline. Generated guest bindings are never
  imported or evaluated. New selections and account changes cancel stale checks.
- Review diffs show exact command additions/removals. An older API's name-only
  diff cannot authorize a command-bearing update: approval is disabled until it
  supplies previous grants or a value-level diff. No AI results are fabricated.
- Pending project metadata is versioned by the API and cannot change public
  descriptions or images before publication. The preview simulates this behavior.
- Creator releases show queued/running/failed scans, AI flags, staff review,
  interrupted publication and signed manual/automatic publication states. Creator
  and review workspaces refresh every ten seconds while visible and cancel timers
  on navigation. Refresh failures preserve review notes; session expiry removes
  staff controls. A manual Refresh status action is always available there.
- Review controls require the server's `scan.review_ready` result and complete
  scan evidence. AI flags need an explanatory note. Staff can rescan a pending
  release; admins can establish/revoke project trust with an audit reason.

## Service contract

The HTTP adapter uses the existing `/v1` routes: `/me`, `/me/mods`, `/mods`,
`/mods/:slug`, `/mods/:slug/send`, `/mods/:slug/remove`, reports, `/submissions`,
`/auth/*` and `/staff/*`.
It includes the host session cookie, repeats `/me`'s CSRF token on writes and sends
release bytes as multipart forms. The API must derive identity, hashes, requested
grants and publication authorization from trusted state and actual uploaded bytes.

Multipart submissions contain `listing`, one component `file`, repeated `images`
file parts, and ordered `image_metadata` JSON entries `{caption, alt}`. The adapter
decodes only locally prepared PNG/JPEG/WebP data; it never fetches arbitrary image
URLs for upload. Descriptions allow 40,000 characters; category, license and release
notes are saved with the release. Failed uploads retain the complete draft.

Public gallery URLs derive from `/mods/media/<sha256>`. Pending images use
`/me/mods/<id>/media/<sha256>` with credentials and exact origin CORS; only the
creator and active staff may read them. API-provided URL strings do not override
the digest-derived route. Staff download the exact artifact from
`/staff/versions/<id>/file`. Scan findings are inert text, and public summaries omit
private scanner evidence. Automatic publication is reported only after the API
marks the release approved. Local roles never authorize a write.

`POST /mods/:slug/remove` sends `{sha256, sent_at}` from `/me`'s saved selection.
The API requires the browser session and CSRF token, scopes deletion to that
account, and notifies its connected clients. A 409 refreshes a changed selection
without deleting a newer send. Hidden and pulled releases remain removable.
Drafts are local, including in HTTP mode, and are not presented as server-synced state.

Client capability descriptors are generated through `source.json`. Website reach
groups are presentation/review categories. The client `sensitive` flag describes
gameplay effects, not a malware rating. Unknown grant names are rejected; new
known descriptors without a website group use the most restrictive group. New
client value types fail the build rather than silently becoming booleans.

## Required before production enablement

1. Test Microsoft personal-account OAuth + PKCE and Xbox/XUID resolution, bound
   state, exact redirect/origin allowlists, Secure HttpOnly cookies, CSRF, role
   revocation and account-switch isolation on the real site/API domains.
2. Merge and deploy [the API implementation](https://github.com/cinnabar-mc/cinnabar-api/pull/32)
   before deploying this website. Provision private quarantine/distribution buckets,
   the separate scanner and its limited credentials, signing and Microsoft secrets.
   The API owns static validation, raster decoding, bounded AI triage, trust,
   signed publication and recovery. Browser checks can be bypassed.
3. Verify scanner failures, expired evidence, trust revocation and interrupted
   promotions against the deployed API. Missing/failed/timed-out checks must hold
   publication. AI cannot override deterministic blocks or establish creator trust.
4. Verify same-site private image cookies, caption/alt text, real artifact uploads
   and polling on the deployed site/API domains. No scanner or signing credentials
   belong in the browser or website configuration.
5. The client verifies signed manifests/hashes, compatibility and exact permission
   consent, installs atomically and honors signed revocations with a documented
   offline/freshness policy.

This change wires the UI to the API; it does not deploy infrastructure or certify
mods as safe. The scanner uses static evidence and AI triage, with no guest-code
execution or full source audit. Website secrets stay in GitHub's `website`
environment; only `main` deploys. Use an explicit mock build for local design demos.

## Regression coverage

Run the README commands after changes. Security fixtures cover malformed framing,
duplicate/escaped keys, command expansion, full type/bytecode validation, a start
that must never run, inert Markdown/media, private pending metadata and removable
unavailable entries. Controller tests cover focus/search retention, identity-scoped
drafts/libraries, stale file checks, server scan gates, AI flag notes, status polling,
session expiry and upload recovery. HTTP tests assert multipart bytes/metadata,
digest-derived private/public gallery routes and CSRF cleanup. Renderer tests
assert a live default, an explicit mock override and generated client descriptors.
