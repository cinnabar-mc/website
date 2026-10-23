# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Players** of Cinnabar, a non-vanilla Minecraft Bedrock client. They reach the site to
  download the client, see how many people are playing, and (with the marketplace) find
  mods to run in it. Most arrive from Discord or GitHub links, on desktop or phone.
- **Creators** are players who build sandboxed WebAssembly mods and want them listed.
  Any player who signs in with Microsoft can submit; nothing is public until staff approve it.
- **Staff** (moderators and admins) review submissions, answer reports, pull unsafe
  releases and manage who holds staff roles. They work through a queue, often in short
  sessions between other duties.

## Product Purpose

Cinnabar is a Minecraft Bedrock client with its own engine. The website publishes its
downloads and live player activity. The marketplace adds one trusted place to find,
install and moderate Cinnabar mods, on the web and inside the game, under the same
Microsoft/Xbox identity the player already uses to play. Success means a player can trust
that a listed mod was reviewed, can see exactly which permissions it asks for, and can
send it to their game in one step.

## Positioning

Accounts are the player's Xbox identity (XUID), not a separate website account: signing in
on the web with Microsoft and signing into the game resolve to the same person, so roles,
installs and reports follow the player between the site and the client. Mods are
sandboxed WASM components whose capabilities are denied by default and granted per mod.

## Operating Context

- The client signs players in with Microsoft (device code flow) and proves identity to the
  Cinnabar API with a Minecraft multiplayer token; the API derives the XUID from it.
- Mods are single `.wasm` components with metadata sections (name, description, version,
  authors, licenses, icon) and a `cinnabar:grants` section listing requested capabilities.
  The client's Settings → Mods tab already imports, enables, orders, grants and updates them.
- The API is a Cloudflare Worker (Hono, one SQLite Durable Object, R2). It has no web login,
  sessions, roles or upload handling yet.

## Capabilities and Constraints

- All mods are free. No prices, purchases or payouts are shown or implied.
- Microsoft sign-in is required to submit, review, report or send a mod to the game.
  Browsing is public.
- Staff roles: moderator and admin, plus an owner bootstrap. Every staff action is audited.
- The site is static HTML, CSS and JavaScript rendered by `render.py` and served as Cloudflare
  static assets with no Worker script. Dynamic behavior comes from the API.
- Open: real Microsoft app registration, signing keys for approved releases, the client's
  in-game marketplace screen, and the API endpoints. The proof of concept runs on a
  clearly labelled local mock until those exist.

## Brand Commitments

- Name: Cinnabar. Tagline "A familiar world. A new client." Edition line "Minecraft Bedrock client".
- Cinnabar red (from the client icon), the title wordmark `title.png`, and the client icon
  come from the client repository through `source.json`; never duplicate them here.
- Honest disclaimers stay: Cinnabar is non-vanilla and still in development.

## Evidence on Hand

- Real: release manifest, live player count and history endpoints, the client icon, title
  art, Discord mark, two example mods in the client repo (`hello-mod`, `time-changer`).
- Absent: real marketplace listings, creators, install counts, ratings and reviews. Any shown
  in previews are sample data and must be labelled as such.

## Product Principles

1. One identity: the player's Xbox account is the account everywhere.
2. Permissions are the headline. A mod's requested capabilities are shown before anything
   promotional about it.
3. Nothing public without review; every staff decision leaves a trail.
4. Truth over hype: no invented numbers, and preview data is labelled.
5. The site and the game should feel like one product, not two storefronts.

## Accessibility & Inclusion

Keyboard operable with visible focus, 44px touch targets, WCAG AA contrast on the dark
ground, reduced-motion respected. Matches the existing site's practice.
