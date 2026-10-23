---
name: Cinnabar
description: Moss pixel ground, square panels and red Bedrock-bevel buttons for the Cinnabar client's download page and mods marketplace.
colors:
  cinnabar-red: "#B8281E"
  cinnabar-red-base: "#451510"
  bevel-outline: "#180d0b"
  bevel-floor: "#0d100d"
  neutral-face: "#3a4739"
  neutral-base: "#1a2119"
  selection: "#a82c22"
  ground: "#141815"
  well: "#101511"
  panel: "#1c231d"
  raised: "#232b23"
  hover: "#2a342a"
  line: "#394337"
  edge: "#505b4c"
  text: "#edf2eb"
  soft: "#c4cdc1"
  muted: "#acb7a9"
  faint: "#8d998a"
  focus: "#f8c1af"
  reach-0: "#95c783"
  reach-1: "#c3d38a"
  reach-2: "#e6d7a8"
  reach-3: "#f0a868"
  reach-4: "#f27a63"
  reach-off: "#2f392e"
  caution-border: "#6b5a2e"
  caution-fill: "#2a2414"
  caution-text: "#f1e3b8"
  danger-border: "#7a3a30"
  danger-text: "#ffb4a6"
  chip-fill: "#18201a"
  chip-border: "#3f4a3d"
typography:
  headline:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
  dialog-title:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.3
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    fontFeature: "tnum"
  label:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "28px"
  3xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.cinnabar-red}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "10px 18px"
    height: "48px"
  button-neutral:
    backgroundColor: "{colors.neutral-face}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "10px 18px"
    height: "48px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.soft}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
    height: "44px"
  button-quiet-hover:
    backgroundColor: "{colors.hover}"
    textColor: "#ffffff"
  button-disabled:
    backgroundColor: "#2b332a"
    textColor: "{colors.faint}"
  input-field:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "20px"
  chip:
    backgroundColor: "{colors.chip-fill}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 7px"
  pill:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  rung-link:
    backgroundColor: "transparent"
    textColor: "{colors.soft}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
    height: "52px"
  rung-link-current:
    backgroundColor: "{colors.raised}"
    textColor: "#ffffff"
  notice:
    backgroundColor: "{colors.caution-fill}"
    textColor: "{colors.reach-2}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
---

# Design System: Cinnabar

## Overview

**Creative North Star: "The Bedrock Workbench"**

Cinnabar's web surfaces sit on the same dark moss ground as the game's dirt-and-grass palette: a 256px pixel texture at 45% opacity over near-black green, darkened toward the edges by a radial vignette. Everything placed on it is square. Panels are flat bordered slabs. The single raised thing in the world is the button, built like a Minecraft Bedrock button with an inner bevel, a dark outline and a solid base block underneath that it presses into.

The landing page (`index.html.in`) established the world. The mods marketplace (`mods.html.in`, `marketplace.js`) extended it into a dense operating surface: a reach scale running from green to coral, a five-cell reach meter, square capability chips, status pills, tables and panels. Text is system-ui. Anything a player might compare, copy or verify is set in ui-monospace: versions, hashes, counts, capability tokens, button labels and dialog titles.

The in-game marketplace mock (`docs/in-game-marketplace.html`) follows the client's OreUI conventions. It's an adaptation for another host, not part of this web system, so its tokens aren't recorded here.

**Key Characteristics:**
- Moss pixel-texture ground with a vignette; flat, square panels on top of it.
- Buttons are the only raised objects, with a hard bevel and a base block. They press down 3 to 4px when activated.
- Corner radius is zero everywhere.
- A five-step reach ramp (green, sage, sand, amber, coral) is the only signal colour scale.
- Monospace for data and actions, system-ui for reading.

## Colors

The palette is a narrow moss-green neutral ladder lit by one brick red and a warm five-step signal ramp.

### Primary
- **Cinnabar Red** (`cinnabar-red`): the button face, the underline under the current nav item and tab, the page's `accent-color`, and a 4% glow behind the landing logo. It is injected at render time from the first `<rect>` fill of the client's icon (`@@RED@@`) and must never be hard-coded in a template.
- **Fired Clay Base** (`cinnabar-red-base`): the solid block under a red button. **Bevel Outline** (`bevel-outline`) is the 2px button border, and **Bevel Floor** (`bevel-floor`) is the second, darker step of the base.
- **Selection Red** (`selection`): text selection background on both pages.

### Secondary
- **Reach ramp** (`reach-0` Moss Green, `reach-1` Sage, `reach-2` Sand, `reach-3` Amber, `reach-4` Coral): what a mod is allowed to touch, from nothing sensitive to the most reach. It colours rung top borders, the reach meter's lit cells, band underlines, chip squares and the ladder's highlighted row (14% mixed into `raised`). The same ramp also carries status: `reach-0` is approved, the online dot and "sent"; `reach-2` is submitted and the review's "why" note; `reach-3` is changes requested; `reach-4` is invalid fields and added capabilities in a diff. `reach-off` is an unlit meter cell.

### Tertiary
- **Caution** (`caution-border`, `caution-fill` at 80% alpha, `caution-text`): the sample-data notice, the landing disclaimer, sensitive chips, tags and the submitted pill border. Text on caution fill uses `reach-2`.
- **Danger** (`danger-border`, `danger-text`): error text, rejected or pulled pills, and "new capability" tags.

### Neutral
- **Moss Ground** (`ground`): the page background under the texture.
- **Well** (`well`): recessed fields such as inputs, search, install command and code blocks. It's darker than the ground.
- **Panel** (`panel`), **Raised** (`raised`), **Hover** (`hover`): the three surface steps, used for the resting slab, the selected item and pointer hover.
- **Line** (`line`): 1px dividers, row rules and header underlines. **Edge** (`edge`): panel, field and dialog borders.
- **Text** (`text`), **Soft** (`soft`), **Muted** (`muted`), **Faint** (`faint`): four text levels, used for body, secondary prose, labels and metadata, and placeholders and disabled text. White (#fff) is reserved for names, active nav and pressed or selected states.
- **Focus** (`focus`): the pale coral focus ring on every page.

### Named Rules
**The One Ramp Rule.** The reach ramp is the only signal scale. Status, severity and capability reach all borrow from it. Don't introduce a separate success green or warning yellow.

**The Red Is Pressable Rule.** Cinnabar red appears only on what you press (buttons) or where you are (current nav and tab underline, `accent-color`). It never fills a panel or a block of text.

## Typography

**Body Font:** system-ui (with sans-serif)
**Label/Mono Font:** ui-monospace (with SFMono-Regular, Menlo, Consolas, monospace)

**Character:** The native UI face handles all reading. Monospace is the instrument face: it labels every button, sets dialog titles, and carries every version, hash, count and capability token.

### Hierarchy
- **Headline** (700, 1.75rem, 1.2, -0.01em, balanced wrap): the single page `h1` on marketplace views.
- **Title** (700, 1.125rem / 1.0625rem, 1.3): rung band headings and section headings.
- **Dialog Title** (mono 700, 1.25rem, 1.4): every `dialog` heading, on both pages.
- **Body** (400, 1rem, 1.5): default text. Prose and summaries are capped at 62 to 70ch.
- **Body Small** (400 to 600, 0.875rem): nav, form labels, tables and panel text.
- **Button** (mono 700, 0.875rem, 1.3; 0.8125rem in rows; 1rem on the landing hero): all bevel button labels, with a `0 2px #0006` text shadow.
- **Data** (mono 400, 0.8125rem, tabular numerals): versions, counts, hashes, approvals, the gamertag line.
- **Label** (mono 400, 0.75rem, 1.5): chips, pills, flap status text, table counts.

The type ramp isn't uppercase and has no tracking-out. Table headers use 600 at 0.75rem in `muted`, in sentence case.

### Named Rules
**The Mono Is Data Rule.** If a reader might compare, copy or verify it, set it in mono with tabular numerals. If they read it as a sentence, set it in system-ui.

## Layout

Content sits in a centered column (`min(100%, 1180px)` on the marketplace, 1100px header and 640px hero on the landing page). Page side padding is 40px, dropping to 20px at 860px (marketplace) or 700px (landing).

The marketplace catalogue is a two-column grid: a 248px sticky rail of rungs and a fluid main column, with a 40px gap. Mod rows use fixed columns (64px mark, fluid main, 76px version, 156px status/action) with a 16px gap and 16px vertical padding, separated by `line` rules. Detail and submit views put a fluid column next to a 300 to 320px side panel. The staff console pairs a table with a sticky 340 to 420px review panel.

Spacing reuses 4, 8, 12, 16, 20, 28 and 40px. Band sections are spaced 36px apart. Interactive targets are at least 44px tall; buttons are 48px.

Breakpoints:
- **1080px:** rows drop the version column and the console stacks.
- **860px:** the rail becomes a six-cell strip with reach-coloured top borders, the header wraps search onto its own line, and side panels stack.
- **560px:** rows become two columns, with the status and action pair spanning a full-width line beneath.

### Named Rules
**The Columns Stay Put Rule.** A row's status changes in place: the flap text restyles and flips, but the columns never shift or reflow.

## Elevation & Depth

Depth is mostly tonal: ground, then panel, then raised, with `well` recessed below the ground. Only three kinds of objects get shadows. Buttons get a hard, zero-blur Bedrock bevel; this is the world's native material, not a borrowed neobrutalist offset. Floating layers (toast, dialog, channel menu) get one large soft drop. Pixel icons get a hairline inset.

### Shadow Vocabulary
- **Bevel** (`inset 0 3px #ffffff35, inset 3px 0 #ffffff16, inset -3px 0 #0002, inset 0 -4px #0004, 0 4px 0 var(--base), 0 6px 0 #0d100d`): every filled button at rest. The landing hero button uses 5px/7px base steps plus a `0 14px 25px #0004` ambient drop.
- **Bevel Pressed** (`inset 0 3px #ffffff35, inset 0 -3px #0004, 0 1px 0 var(--base), 0 3px 0 #0d100d` with `translateY(3px)`): `:active`, so the button sinks into its base.
- **Float** (`0 16px 80px #0008` for dialogs, `0 12px 40px #0009` for the toast, `0 16px 40px #0008` for menus): overlays only. The dialog backdrop is `#0009` with a 3px blur.
- **Icon Inset** (`inset 0 0 0 1px #ffffff14` inside a 1px `#0d100d` border): mod icons.

### Named Rules
**The Only Raised Thing Rule.** Panels, chips, pills and rows are flat. If it has a bevel, it's a button.

## Shapes

Every corner is square (`rounded.none`), including inputs, selects, dialogs, chips and pills. The silhouette language is pixel geometry. The reach meter is a stack of 5px cells, the chip marker is a 6px square, the status and online dots are 7 to 8px squares, the search icon is a pixel-stepped SVG path, and mod icons render with `image-rendering: pixelated`. Borders are 1px for dividers, panels and fields. They're 2px for button outlines, dialogs, the toast, the channel menu, table header rules, band underlines and the dashed drop zone.

## Components

### Buttons
Tactile, pressable blocks.
- **Shape:** square, with a 2px `bevel-outline` border.
- **Primary:** Cinnabar red face, white mono 700 label, 48px tall (44px in rows, 62px on the landing hero), Bevel shadow. A face/base custom-property pair (`--face`, `--base`) lets variants reuse the bevel.
- **Hover / Focus / Active:** hover brightens to 1.12. Focus shows a 2px `focus` outline with a 3px offset. Active uses Bevel Pressed.
- **Neutral:** a moss face (`neutral-face` on `neutral-base`) for secondary actions such as Cancel.
- **Quiet:** transparent, no bevel, `soft` text at 500 weight. Hover fills it with `hover`.
- **Sign-in:** a graphite face (#2f2f2f on #111) with the Microsoft logo and a system-ui 600 label.
- **Disabled:** a dimmed moss face with `faint` text and no text shadow.

### Chips
- **Style:** square, with a `chip-border` 1px border on `chip-fill`, `soft` mono label text, and a leading 6px square in the capability's reach colour.
- **Sensitive:** `caution-border` and `caution-text`.

### Pills (status)
- **Style:** square and outlined with no fill, in mono label text. Each status takes its colour from the reach ramp or the danger pair, as described under Colors.

### Cards / Containers (panels)
- **Corner Style:** square.
- **Background:** `panel`.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px `edge`. Dialogs, the toast and menus use 2px.
- **Internal Padding:** 20px for panels, 28px for dialogs, and 12px 16px for ladder rows.

### Inputs / Fields
- **Style:** `well` fill, 1px `edge` border, square, 44px minimum height, system-ui 0.9375rem. Textareas are at least 96px tall. The drop zone uses a 2px dashed `edge` border on translucent `well`.
- **Focus:** 2px `focus` outline at a 1px offset. Search raises its border to `soft` on `:focus-within`.
- **Error:** `aria-invalid` sets the border to `reach-4`. Error text is `danger-text` at 500 weight.

### Navigation
- **Site nav and tabs:** 44px text links in `muted` at 0.875rem (500 for nav, 600 for tabs). Hover turns the text white. The current item is white with a 2px Cinnabar red bottom border.
- **Header:** brand mark at 24px, nav, search and account in one row above a 1px `line` underline. At 860px or narrower, the brand word hides and search wraps to its own line.

### Reach Meter (signature)
A vertical meter of five square cells, 10px wide with 5px cells and a 2px gap. Lit cells take the item's reach colour (`--c`, set by `data-reach`) and unlit cells are `reach-off`. It repeats at three sizes: in the rail (14px wide with 8px cells), in each row's mark, and in band heads (12px wide with 4px cells).

### Rung Rail
Rung links are three-column grid items (glyph, label, count) with a hint line, 52px tall. The current rung gets an `edge` border on `raised`. On narrow screens they collapse into a strip of cells, each with a 3px reach-coloured top border.

### Permission Ladder
A bordered `panel` list of the five rungs. Rungs within the mod's reach are drawn in `soft` and rungs above it are dimmed. The mod's top rung is tinted 14% with its reach colour.

## Do's and Don'ts

### Do:
- **Do** read Cinnabar red from `@@RED@@` (the client icon) and the shared marketplace values from the `:root` custom properties.
- **Do** give every filled button the full Bevel and Bevel Pressed pair. New variants should only change `--face` and `--base`.
- **Do** colour any severity or status from the reach ramp (`reach-0` to `reach-4`) or the danger pair.
- **Do** set versions, hashes, counts and capability tokens in mono with tabular numerals.
- **Do** keep targets at least 44px tall and use the 2px `focus` ring.
- **Do** draw icons as pixel-stepped inline SVG paths in `currentColor`.
- **Do** honour `prefers-reduced-motion` by disabling the flap and shimmer animations.

### Don't:
- **Don't** round any corner.
- **Don't** put a shadow on panels, chips, pills or rows. Elevation belongs to buttons and floating overlays only.
- **Don't** use Cinnabar red as a fill for surfaces, text blocks or status.
- **Don't** add a second signal palette alongside the reach ramp.
- **Don't** set paragraphs or long descriptions in mono.
- **Don't** use typographic characters (×, →) as icons. Use SVG.
