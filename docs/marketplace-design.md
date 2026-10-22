# Marketplace screen

Mode: Operate. Extend the established cinnabar.gg website with `/marketplace/`
and a Marketplace header link. Players should reach a listing, read its requested
permissions before adding it to their library, and keep their search.

## Direction contract

THESIS: A compact community storefront with inspectable permissions and a working
publishing desk. Discovery and administration use familiar navigation.

OWN-WORLD: Use the established cinnabar.gg visual identity, including its shared
generated block texture at `/texture.svg`, layered vignette, forest ground, sage
text, and system-ui body type. Preserve the exact cube and Cinnabar header at the
left and Marketplace, GitHub, and Discord links at the right. Primary actions use
the site's sharp, bevelled, raised red buttons with `ui-monospace` labels and its
existing corner, border, and focus conventions. Established raised shadows,
texture, and monospace controls override generic style bans. Authored line icons
identify entries.

STORY: Browse free mods as a signed-in player, inspect one beside the catalog,
then add it to My library. Creators prepare submissions and staff review them.
Shared fictional profiles make the browser-local scenarios feel like ordinary
account workflows without claiming that Microsoft authentication is connected.

FIRST VIEWPORT: The shared header precedes the original red `title.png` masthead,
a compact profile button with avatar initials, name, and role, section navigation,
search and category filter. Do not add a demo strip or developer setup panel. Keep the
mark compact at 220–300px wide on desktop and smaller on mobile. A two-column
catalog sits beside a wider persistent detail panel. The selected entry exposes
its permissions before its save-to-library action. Mobile stacks the detail
directly after the selected entry.

FORM: Code-first extension of the incumbent visual world; the user specified the
scope and design direction. The signature interaction preserves the catalog while
selection replaces the adjacent detail, with a short background transition.

FINISH: Capture desktop and mobile, exercise workflow states, run the design
detector once, and hand the reviewed files and evidence to the coordinating owner.

## Layout and accessibility

Use native controls, visible labels, persistent focus outlines, and semantic
headings. Announce action results without moving focus. Submission fields and
review reasons stay inline. Keep discovery, detail, and creator/staff flows intact.
Account shows the shared profile name, gamertag, role, and Microsoft provider.
Switch account and Reset saved data live inside secondary Account disclosures;
preserve their expanded state and keyboard focus after actions. Resolve known
account names in staff records and audit activity. The shared role policy controls
capabilities; roster edits and account metadata grant no real permissions.

The presentation deliberately uses a fictional signed-in state. Authentication,
artifact transfer, execution, and server publishing are not implemented. Explain
these limits in contributor docs, not repeated catalog/form/footer notices. The
library detail has one useful sentence explaining that adding a mod neither
installs it nor grants its requested permissions. Controls are at
least 44px high; the header, masthead, forms, and catalog fit mobile widths without
horizontal overflow. Honor reduced motion. Keep the landing page's composition
and existing download controls intact.
