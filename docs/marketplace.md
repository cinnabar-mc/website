# Marketplace implementation boundary

The website combines category/library workflows with permission-aware review and
an HTTP adapter, while retaining a labelled browser preview by default. The
canonical entry is `/mods/`; `/marketplace/` serves the same hash application.
No SPA fallback or dynamic Worker is required.

## Website behavior

- Search/filter state survives a project visit. The library belongs to the chosen
  account; unavailable selections remain visible and removable in the preview.
  Adding a mod never grants runtime permissions or installs code.
- Descriptions support Markdown headings, lists, emphasis, code and HTTPS links,
  rendered as DOM nodes. Creator HTML is plain text. Images accept raster data
  in the preview or HTTPS URLs; captions and alt text are plain text.
- Project → Images → Release → Checks & publish keeps a browser-local draft per
  account. Image inputs are limited to 8 MiB and 24 megapixels, resized to at most
  1600 pixels and re-encoded as WebP. A draft has at most 12 images and 2 MiB of
  total image data. Component bytes are never saved in browser storage.
- Strict metadata checks enforce the whole component header, known section IDs,
  section-local bounds, bounded u32 lengths, UTF-8 and unique declarations/grants.
  The pinned Jco parser checks component structure/types and guest bytecode in a
  disposable worker with a 20-second deadline. Generated guest bindings are never
  imported or evaluated. New selections and account changes cancel stale checks.
- Review diffs show exact command additions/removals. An older API's name-only
  diff cannot authorize a command-bearing update: approval is disabled until it
  supplies previous grants or a value-level diff. No AI results are fabricated.
- Pending project metadata is versioned in the preview and cannot change public
  descriptions or images before approval. Review/self-review/role rules are
  checked by the mock transport independently of the interface.

## Service contract

The HTTP adapter uses the existing `/v1` routes: `/me`, `/me/mods`, `/mods`,
`/mods/:slug`, `/mods/:slug/send`, reports, `/submissions`, `/auth/*` and `/staff/*`.
It includes the host session cookie, repeats `/me`'s CSRF token on writes and sends
release bytes as multipart forms. The API must derive identity, hashes, requested
grants and publication authorization from trusted state and actual uploaded bytes.

The preview-only `/mods/:slug/remove` route is not called in HTTP mode. The current
API does not implement image publication: the editor retains images locally and
blocks submitting them over HTTP instead of silently dropping them. Category,
license and release notes are preview metadata pending a versioned API extension;
the HTTP contract submits only its supported listing fields. Drafts are local,
including in HTTP mode, and are not presented as server-synced state.

Client capability descriptors are generated through `source.json`. Website reach
groups are presentation/review categories. The client `sensitive` flag describes
gameplay effects, not a malware rating. Unknown grant names are rejected; new
known descriptors without a website group use the most restrictive group. New
client value types fail the build rather than silently becoming booleans.

## Required before production enablement

1. Test Microsoft personal-account OAuth + PKCE and Xbox/XUID resolution, bound
   state, exact redirect/origin allowlists, Secure HttpOnly cookies, CSRF, role
   revocation and account-switch isolation on the real site/API domains.
2. Independently validate complete components, imports and compatibility on the
   server. Browser checks can be bypassed. Quarantine files privately and bind
   scan/review decisions to immutable artifact hashes and project revisions.
3. Add project/media APIs with server image decoding/re-encoding, bounds and
   authorization, library removal and exact previous grant values. Browser roles
   and preview state never authorize production actions.
4. Add contained static/runtime checks and evidence-based AI triage. Scanners
   have no signing/publishing credentials. Missing/failed/timed-out checks keep a
   release private. AI cannot override a hard validation failure or grant trust.
5. Established creators can publish eligible releases automatically only through
   server policy: active project-scoped trust, all checks complete, unchanged
   scanned bytes/content, no expanded permissions/commands, unchanged ownership
   and no suspension or incident hold. New authority requires human review.
6. The client verifies signed manifests/hashes, compatibility and exact permission
   consent, installs atomically and honors signed revocations with a documented
   offline/freshness policy.

Until these requirements pass, use the labelled mock backend. This website change
does not certify mods as safe, implement the malware service or enable real
automatic publication. Website secrets stay in GitHub's `website` environment;
only `main` deploys.

## Regression coverage

Run the README commands after changes. Security fixtures cover malformed framing,
duplicate/escaped keys, command expansion, full type/bytecode validation, a start
that must never run, inert Markdown/media, private pending metadata and removable
unavailable entries. Controller tests cover focus/search retention, identity-scoped
drafts/libraries, stale file checks and staff evidence/note recovery. Renderer tests
change a pinned client permission label and assert that generated data follows it.
