# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Cinnabar players browse free community mods. Creators prepare listings; moderators
review submissions; administrators manage staff.

## Product Purpose

The existing website provides client downloads and player activity. The additive
marketplace proof of concept demonstrates discovery and publishing workflows.

## Capabilities and Constraints

The marketplace uses synthetic examples and browser-local state. It cannot install
mods, authenticate accounts, grant real permissions, or publish submissions.
Microsoft account registration and an authoritative backend remain pending.
The interface opens as a fictional signed-in player. Account shows the scenario's
name, gamertag, role, and Microsoft provider; Switch account offers the shared
profiles for player, creator, and staff workflows. This is a presentation of local
scenarios, not an authenticated Microsoft session. Account metadata supplies names;
capabilities still come from the shared role policy. Library changes, submissions,
staff assignments, and audit activity stay in browser storage. Reset saved data is
inside Account preferences. The client repository owns catalog data, account
profiles, roles, and review transitions.

Keep setup instructions and proof-of-concept limitations in contributor docs.
Normal product screens use concise task language without demo banners, repeated
local-state notices, disabled sign-in setup, or simulated upload/download controls.
Adding to the library does not install a mod or grant its requested permissions.

## Brand Commitments

Use the established cinnabar.gg visual identity: the shared generated block texture
at `/texture.svg`, layered vignette, forest ground, and muted sage text. Preserve
the exact cube and Cinnabar header at the left, with Marketplace, GitHub, and
Discord links at the right. Use the original red `title.png` mark as a compact
masthead, 220–300px wide on desktop and smaller on mobile.

Primary buttons are sharp, bevelled, raised, and red, with `ui-monospace` labels.
Follow the site's existing corner, border, and focus conventions. Its established
raised shadows, texture, and monospace controls take precedence over generic style
bans. Keep system type for body text and preserve the landing page. Build the
marketplace directly in the existing static website, without new raster artwork.

Keep discovery, listing detail, and creator/staff workflows usable on mobile, with
controls at least 44px high. Players read requested permissions before saving a
listing to their library.
