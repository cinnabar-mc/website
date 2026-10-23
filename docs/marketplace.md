# Mod marketplace design

Status: proposal and proof of concept. The website preview at `/mods/` runs on an in-browser
mock (`marketplace-mock.js`) that implements the API contract below. The API endpoints, the
Microsoft app registration and the in-game screen don't exist yet.

## The idea in one paragraph

Mods are filed by **reach**: how much of a player's game they're allowed to touch. The marketplace
reads each mod's `cinnabar:grants` request and files it on the highest of five rungs. Players browse
by rung and see every requested permission before the pitch. The rung also sets how many staff
have to approve the mod. Every account is the player's **Xbox identity (XUID)**. Signing in on the
web with Microsoft and signing in to the game resolve to the same person, so "Send to game",
roles and reports follow the player between the site and the client without a linking step.

## Identity

| Where | How the player proves who they are | What the API learns |
| --- | --- | --- |
| Game | Already done today: a Minecraft multiplayer token over `/v1/connect`, plus the key-bound proof | `xid` (XUID), `xname` |
| Website | Microsoft OAuth → Xbox user token → XSTS token, all handled by the API | `xid` (XUID), `gtg` (gamertag) |

Web sign-in, run entirely by the API worker:

1. `GET /v1/auth/microsoft/start?return_to=<site URL>` stores `state`, a PKCE verifier and the
   validated `return_to` for ten minutes. It then redirects to
   `login.microsoftonline.com/consumers/oauth2/v2.0/authorize` with scope `XboxLive.signin` only.
2. `GET /v1/auth/microsoft/callback` checks `state`, redeems the code, then posts
   `RpsTicket: "d=<access token>"` to `user.auth.xboxlive.com/user/authenticate`. It exchanges the
   user token at `xsts.auth.xboxlive.com/xsts/authorize` with `RelyingParty: "http://xboxlive.com"`,
   which returns `xid` and `gtg` in `DisplayClaims.xui[0]`.
3. It discards every Microsoft and Xbox token immediately and stores only the XUID and gamertag.
   This matches the API's existing rule that tokens are never stored.
4. It issues a session: 32 random bytes in a `__Host-cinnabar_session` cookie (Secure, HttpOnly,
   SameSite=Lax), keyed by its SHA-256 in SQLite. Sessions last 30 days for players. Staff
   sessions last 12 hours, and staff must sign in again within 10 minutes before changing roles.
5. It redirects to `return_to`, which must be on the website origin.

XSTS errors get plain messages:
- `2148916233`: no Xbox profile yet. Tell the player to sign in to Minecraft once.
- `2148916238`: a child account. A parent must allow it in Xbox family settings.

Cookies and CORS:
- The cookie only flows when the site and API share a registrable domain, for example
  `cinnabar.gg` and `api.cinnabar.gg`.
- The current `*.workers.dev` website origin is cross-site, so move the site to its custom
  domain, or proxy `/api/*` through Caddy, before enabling live sign-in.
- Credentialed CORS allows exactly the website origin.
- Every non-GET request needs the `X-Cinnabar-CSRF` token that `GET /v1/me` returns, plus a
  matching `Origin`.

## Roles

| Role | Granted by | Can |
| --- | --- | --- |
| Player | signing in | browse, send to game, report, submit mods and track their own submissions |
| Moderator | an admin | review Looks/Reads/Watches mods alone, add the first approval to Network mods, ask for changes, reject, hide a listing, resolve reports |
| Admin | the owner | everything a moderator can, plus approve Acts and Network mods, pull published versions, suspend creators, add or remove moderators |
| Owner | `OWNER_XUIDS` in the API configuration | everything an admin can, plus add or remove admins |

- "Creator" is not a role. It is any player who owns a listing.
- Nobody reviews their own mod, approves the same version twice, or changes their own role.
- Owners exist only in configuration, so a compromised admin account can't lock the team out.
- Every staff action writes an append-only audit row: actor, action, target, note and time.
- Roles are keyed by XUID. The same moderator is recognised in game, which leaves room for
  in-game review tools later.

## Reach and review

The rungs come from the client's own `ModGrants` descriptors (`crates/mod-host/src/grants.rs`):

| Rung | Capabilities | Approval |
| --- | --- | --- |
| Looks | `environment`, `hud`, `settings`, `render`, `world_draw`, `render_material`, `render_post`, `render_depth`, `fullbright` | one staff member |
| Reads | `terrain`, `player_state`, `entities`, `items`, `recipes`, `screen` | one staff member |
| Watches | `players`, `entity_observe`, `entity_highlight`, `block_highlights`, `render_through_walls` | one staff member |
| Acts | `camera`, `controls`, `keys`, `item_use`, `movement`, `interaction`, `inventory`, `commands` | an admin |
| Network | `packet_delay`, `packets`, `wasi` | two staff, one of them an admin |

- Every capability the client marks sensitive lands on Acts or Network.
- Acts and Network mods must link their source, and reviewers check that it builds to the
  uploaded SHA-256.
- The review checklist explicitly rejects unfair advantages on servers (x-ray, aim help, reach,
  auto-clicking), whatever rung the mod sits on.
- `marketplace-core.js` currently copies the table. Before merge, the client should export it as
  a data file that `source.json` pins, like the other shared inputs.

Version lifecycle:
- `submitted` → `approved` | `changes` | `rejected`.
- An approved version can later be `pulled`.
- A listing is public while it has an approved, unpulled version and isn't hidden.
- Updates enter review alone. The previous approved version stays live until its replacement is
  approved, and reviewers see the permission diff.

## Distribution and trust

- Uploads go to R2 under their SHA-256 and are capped at 16 MiB, the client's source limit.
  The API reads the same custom sections the client reads, without instantiating the component.
- On approval, the API signs a release statement with an Ed25519 marketplace key:
  `{slug, version, sha256, bytes, grants, approved_at, approvers}`.
  - The client pins the public key as a contract constant.
  - It verifies the file's hash and the signature before importing.
  - The signature code in `crates/server-experience` is reusable for this.
- Pulling a version adds it to a signed revocation list.
  - The list is served at `/v1/mods/revocations` and pushed over the socket.
  - The client disables a revoked mod and tells the player the reason staff gave.
- The marketplace never grants permissions. Installed mods arrive with every grant off. The
  player allows them in the existing permission sheet ("Allow requested" or one by one).

## Send to game

`POST /v1/mods/{slug}/send` adds the mod's current version to the player's library and pushes a
`mod_library` message to every live socket for that XUID, the same way `cosmetic_ownership` is
pushed today. `welcome` carries pending entries, so an offline player gets them on next launch.
The client downloads the file by hash, verifies it, imports it disabled, and shows "Sent from
cinnabar.gg: review permissions".

## In game

The client gets a **Mods** screen on the home menu with two tabs:
- **Installed**: today's Settings → Mods content, moved.
- **Marketplace**: the same five rungs as a sidebar, a mod list, and a detail pane that leads
  with the ladder.

Install uses the existing permission sheet. The game already knows the player's XUID from
`welcome`, so it needs no extra sign-in, and the "From the website" strip lists anything sent from
the site. See [`in-game-marketplace.html`](in-game-marketplace.html) for the screen mock and
[`in-game-marketplace.png`](in-game-marketplace.png) for a capture. It belongs in the client's
OreUI (`crates/oreui`), following the Dressing Room's route, view model and shell wiring.

## API contract (v1)

All paths are under the bridge contract's `CINNABAR_API_BASE_URL`. JSON in and out; errors are
`{error, fields?}`. The mock implements every route below except the Microsoft redirect pair, which it
replaces with `POST /auth/preview` and `GET /auth/personas` for sample accounts.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /auth/microsoft/start`, `GET /auth/microsoft/callback` | anyone | web sign-in (above) |
| `POST /auth/signout` | signed in | end the session |
| `GET /me` | anyone | `{account, game_online, library, csrf}` |
| `GET /mods` | anyone | public listings with `reach`, `capabilities`, `version`, `sha256`, `reviewed_by` |
| `GET /mods/{slug}` | anyone | listing plus approved version history |
| `GET /mods/assets/{sha256}` | anyone | the component file, immutable |
| `GET /mods/revocations` | anyone | signed list of pulled versions |
| `POST /mods/{slug}/send` | signed in | queue for the player's game |
| `POST /mods/{slug}/reports` | signed in | `{reason, details}` |
| `GET /me/mods` | signed in | the player's submissions and their status |
| `POST /submissions` | signed in | listing fields plus an uploaded component (multipart when live) |
| `GET /staff/queue`, `GET /staff/versions/{id}` | staff | review queue (highest reach first) and a version with its permission diff |
| `POST /staff/versions/{id}/decision` | staff | `{decision: approve, changes or reject, note}` |
| `POST /staff/versions/{id}/pull` | admin | `{reason}` |
| `POST /staff/mods/{slug}/hide` | staff | `{hidden, reason}` |
| `GET /staff/reports`, `POST /staff/reports/{id}/resolve` | staff | triage reports |
| `GET /staff/people`, `POST /staff/people/role` | staff to read, admin or owner to change | `{gamertag, role, reason}` |
| `GET /staff/audit` | staff | newest first |

Storage, in the Hub Durable Object's SQLite next to `cosmetic_entitlements`:
- `accounts(xuid, gamertag, role, suspended, seen_at)`
- `web_sessions(id_hash, xuid, expires_at, staff)`
- `listings(slug, creator_xuid, name, summary, description, source, hidden)`
- `versions(id, slug, version, sha256, bytes, grants_json, reach, status, note, submitted_at, decided_at, pulled)`
- `approvals(version_id, xuid, admin, at)`
- `reports(...)`, `library(xuid, slug, version, sent_at)`, `audit(...)`

## Work by repository

- **website** (this PR): the `/mods/` preview, staff console, rules and contract tests. Switch
  `marketplace.backend` to `http` in `render.py` once the API ships.
- **cinnabar-api**:
  - Microsoft/XSTS sign-in, sessions and CORS
  - the tables and routes above, and R2 uploads
  - the signing key and revocations
  - the `mod_library` socket message
- **cinnabar** (client):
  - export the capability table as data
  - pin the marketplace public key
  - verified install and revocation handling
  - the Mods screen with the Marketplace tab

## Open decisions

- The website's production domain, which decides the cookie strategy.
- Whether a moderator must also hold a recent client sign-in, for example by approving from the
  game, before reviewing Network mods.
- Upload scanning beyond section parsing. The client's `mod-host probe` could run in a GitHub
  Actions job triggered by the API.
