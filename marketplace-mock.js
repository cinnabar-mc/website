(function () {
  "use strict";

  const core = typeof module !== "undefined" ? require("./marketplace-core.js") : window.CinnabarMarket;
  const STORAGE_KEY = "cinnabar.marketplace.preview.v2";
  const HOUR = 3600000;
  const DAY = 24 * HOUR;

  /** Sample accounts for the preview's sign-in step. None of these are real players. */
  const PERSONAS = [
    { xuid: "2535400000000101", gamertag: "MossyCobble", role: "player", blurb: "Player" },
    { xuid: "2535400000000102", gamertag: "BlockSmith42", role: "player", blurb: "Player who has published mods" },
    { xuid: "2535400000000201", gamertag: "PixelWarden", role: "moderator", blurb: "Moderator" },
    { xuid: "2535400000000301", gamertag: "RedstoneRook", role: "admin", blurb: "Admin" },
    { xuid: "2535400000000401", gamertag: "OreKeeper", role: "owner", blurb: "Owner" },
  ];

  /** Builds the sample marketplace relative to `now`, so ages read naturally on any day. */
  function seed(now) {
    const accounts = {};
    PERSONAS.concat([
      { xuid: "2535400000000103", gamertag: "LumenLeaf", role: "player" },
      { xuid: "2535400000000104", gamertag: "GridWalker", role: "player" },
      { xuid: "2535400000000105", gamertag: "QuartzQueue", role: "player" },
      { xuid: "2535400000000106", gamertag: "GhastlyGus", role: "player" },
      { xuid: "2535400000000107", gamertag: "TideTurner", role: "player" },
    ]).forEach(function (a) { accounts[a.xuid] = { xuid: a.xuid, gamertag: a.gamertag, role: a.role, suspended: false }; });
    const by = function (tag) { return PERSONAS.concat(Object.values(accounts)).find(function (a) { return a.gamertag === tag; }).xuid; };
    const listings = {};
    const versions = [];
    let n = 0;
    /** Adds a listing with its versions; each version is `[version, grants, status, age, approvers]`. */
    function mod(slug, name, creator, summary, description, source, rows) {
      listings[slug] = { slug: slug, name: name, creator: by(creator), summary: summary, description: description,
        source: source, hidden: false, created_at: now - rows[0][3] - DAY };
      rows.forEach(function (row) {
        const at = now - row[3];
        n += 1;
        versions.push({ id: "v" + n, slug: slug, version: row[0], grants: row[1], reach: core.reachOf(row[1]),
          status: row[2], approvals: (row[4] || []).map(function (tag) {
            const xuid = by(tag);
            return { xuid: xuid, admin: core.atLeast(accounts[xuid], "admin"), at: at + HOUR };
          }),
          creator: by(creator), sha256: hash(slug + row[0]), bytes: 90000 + (slug.length * 7919 + n * 3301) % 400000,
          submitted_at: at, decided_at: row[2] === "submitted" ? null : at + 2 * HOUR,
          note: row[5] || "", pulled: row[2] === "pulled" });
      });
    }
    mod("time-changer", "Time Changer", "BlockSmith42", "Cycle your sky between day, sunset, night and midnight with F8.",
      "Changes only what you see: the server's clock and daylight cycle keep running, and no packets are sent.",
      "https://github.com/blocksmith42/time-changer", [["1.2.0", { environment: true }, "approved", 9 * DAY, ["PixelWarden"]]]);
    mod("clear-skies", "Clear Skies", "LumenLeaf", "Softer fog and a cleaner horizon on long render distances.",
      "A post pass that thins distance fog and evens out the horizon colour.", "",
      [["0.4.1", { render: true, render_post: true }, "approved", 4 * DAY, ["PixelWarden"]]]);
    mod("coords-hud", "Coords HUD", "BlockSmith42", "Your coordinates, facing and biome in one tidy corner card.",
      "A small HUD card that reads your position and status. Version 2.1 adds a nearby-mob counter.", "https://github.com/blocksmith42/coords-hud",
      [["2.0.0", { hud: true, player_state: true }, "approved", 6 * DAY, ["PixelWarden"]],
        ["2.1.0", { hud: true, player_state: true, entities: true }, "submitted", 3 * HOUR]]);
    mod("chunk-borders", "Chunk Borders", "GridWalker", "Outlines the chunk you're standing in, for builders and farmers.",
      "Draws the current chunk's edges as thin world lines. Toggle with F9.", "https://github.com/gridwalker/chunk-borders",
      [["1.0.3", { world_draw: true, terrain: true }, "approved", 12 * DAY, ["RedstoneRook"]]]);
    mod("nametags-plus", "Nametags Plus", "LumenLeaf", "Readable nametags with distance, shown only for players you can already see.",
      "Draws a cleaner tag above authorized players, with their distance.", "https://github.com/lumenleaf/nametags-plus",
      [["0.7.0", { players: true, entity_highlight: true }, "approved", 15 * DAY, ["RedstoneRook"]]]);
    mod("keystrokes", "Keystrokes", "QuartzQueue", "Shows your WASD, jump and click inputs on screen for recordings.",
      "Reads your local key presses and draws them as a HUD card. Nothing is sent.", "https://github.com/quartzqueue/keystrokes",
      [["1.1.0", { hud: true, controls: true }, "approved", 2 * DAY, ["RedstoneRook"]]]);
    mod("freelook", "Freelook", "TideTurner", "Hold Alt to look around without turning your body.",
      "Rotates the camera within bounds while held, then snaps back.", "https://github.com/tideturner/freelook",
      [["0.9.0", { camera: true, controls: true, settings: true }, "approved", 20 * DAY, ["RedstoneRook"]]]);
    mod("party-sync", "Party Sync", "QuartzQueue", "Shares waypoints with friends in your party over the session.",
      "Adds waypoint messages to your session so party members see the same markers.", "https://github.com/quartzqueue/party-sync",
      [["0.3.0", { packets: true, wasi: true }, "approved", 8 * DAY, ["PixelWarden", "RedstoneRook"]],
        ["0.4.0", { packets: true, wasi: true, packet_delay: true }, "submitted", 5 * HOUR, ["PixelWarden"]]]);
    mod("ore-glow", "Ore Glow", "GhastlyGus", "Makes ores glow so you can find them faster.",
      "Highlights ore blocks, including ones behind other blocks.", "",
      [["0.1.0", { block_highlights: true, render_through_walls: true }, "submitted", 26 * HOUR]]);
    mod("chat-tweaks", "Chat Tweaks", "TideTurner", "Timestamps, compact joins and a quick-reply key for chat.",
      "Adds a chat overlay and one reply key.", "https://github.com/tideturner/chat-tweaks",
      [["0.9.0", { screen: true, keys: true }, "submitted", 40 * 60000]]);
    mod("sky-tint", "Sky Tint", "BlockSmith42", "Tint the sky to match your texture pack.",
      "A colour picker for sky and fog.", "",
      [["0.1.0", { environment: true, render_post: true }, "changes", 2 * DAY, [], "The settings panel opens over chat and can't be closed with Escape. Please fix and resubmit."]]);
    const reports = [
      { id: "r1", slug: "keystrokes", version: "1.1.0", reporter: by("MossyCobble"), reason: "broken",
        details: "The card covers the hotbar on Android at GUI scale 3.", at: now - 7 * HOUR, status: "open" },
      { id: "r2", slug: "nametags-plus", version: "0.7.0", reporter: by("GridWalker"), reason: "advantage",
        details: "Does this show people through walls?", at: now - 30 * HOUR, status: "resolved",
        resolution: "Checked: it only tags players the session already shows. No change.", resolved_by: by("PixelWarden") },
    ];
    const audit = [
      { at: now - 2 * DAY, actor: by("RedstoneRook"), action: "approved", target: "keystrokes 1.1.0", note: "" },
      { at: now - 4 * DAY, actor: by("PixelWarden"), action: "approved", target: "clear-skies 0.4.1", note: "" },
      { at: now - 2 * DAY + HOUR, actor: by("PixelWarden"), action: "requested changes", target: "sky-tint 0.1.0", note: "Escape doesn't close the panel." },
      { at: now - 30 * HOUR + HOUR, actor: by("PixelWarden"), action: "resolved report", target: "nametags-plus 0.7.0", note: "No change." },
      { at: now - 5 * HOUR + HOUR, actor: by("PixelWarden"), action: "approved (1 of 2)", target: "party-sync 0.4.0", note: "" },
    ].sort(function (a, b) { return b.at - a.at; });
    return { accounts: accounts, listings: listings, versions: versions, reports: reports, audit: audit,
      library: {}, session: null, game_online: {}, counter: n };
  }

  /** A stable, obviously synthetic hex digest for sample files. */
  function hash(text) {
    let out = "";
    let h = 2166136261;
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i) ^ round, 16777619) >>> 0;
      out += ("00000000" + h.toString(16)).slice(-8);
    }
    return out;
  }

  /**
   * An in-browser stand-in for the marketplace API. It enforces the same rules the API must
   * (sessions, roles, review policy) and keeps its state in `storage` so the preview survives reloads.
   */
  function createMockApi(storage, clock) {
    const now = clock || function () { return Date.now(); };
    let state;
    try { state = JSON.parse(storage.getItem(STORAGE_KEY)); } catch (e) { state = null; }
    if (!state || !state.listings) state = seed(now());
    const save = function () { try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } };
    const ok = function (body) { return { status: 200, body: body }; };
    const fail = function (status, error) { return { status: status, body: { error: error } }; };
    const me = function () { return state.session ? state.accounts[state.session] : null; };
    const name = function (xuid) { return (state.accounts[xuid] || { gamertag: "Unknown" }).gamertag; };
    const log = function (action, target, note) {
      state.audit.unshift({ at: now(), actor: state.session, action: action, target: target, note: note || "" });
    };

    /** The newest public version of a listing: approved and not pulled. */
    function liveVersion(slug) {
      return state.versions.filter(function (v) { return v.slug === slug && v.status === "approved" && !v.pulled; })
        .sort(function (a, b) { return b.decided_at - a.decided_at; })[0];
    }

    /** The listing as the public catalogue shows it, or null when nothing about it is public. */
    function publicListing(listing) {
      const live = liveVersion(listing.slug);
      if (!live || listing.hidden) return null;
      const published = live.listing || listing;
      return { slug: listing.slug, name: published.name, summary: published.summary, description: published.description,
        category: published.category, license: published.license, gallery: published.gallery || [], grants: live.grants,
        source: published.source, creator: listing.creator, creator_name: name(listing.creator),
        version: live.version, version_id: live.id, reach: live.reach,
        capabilities: core.requestedCapabilities(live.grants), sha256: live.sha256, bytes: live.bytes,
        updated_at: live.decided_at, reviewed_by: live.approvals.map(function (a) { return name(a.xuid); }).join(", "),
        update_pending: state.versions.some(function (v) { return v.slug === listing.slug && v.status === "submitted"; }) };
    }

    /** Adds display fields a staff or creator view needs to a version. */
    function versionView(v) {
      const listing = state.listings[v.slug];
      const previous = state.versions.filter(function (p) { return p.slug === v.slug && p.status === "approved" && p.submitted_at < v.submitted_at; })
        .sort(function (a, b) { return b.submitted_at - a.submitted_at; })[0];
      const submitted = v.listing || listing;
      return Object.assign({}, v, { name: submitted.name, creator_name: name(v.creator), source: submitted.source,
        summary: submitted.summary, capabilities: core.requestedCapabilities(v.grants), rule: core.approvalRule(v.reach),
        approvals: v.approvals.map(function (a) { return Object.assign({ gamertag: name(a.xuid) }, a); }),
        previous: previous ? { version: previous.version, grants: previous.grants, diff: core.grantDiff(previous.grants, v.grants) } : null,
        hidden: listing.hidden });
    }

    const staffOnly = function () { return core.atLeast(me(), "moderator") ? null : fail(me() ? 403 : 401, "Staff only."); };

    const routes = [
      ["GET", /^\/me$/, function () {
        const account = me();
        return ok({ account: account, game_online: Boolean(account && state.game_online[account.xuid] !== false),
          library: account ? state.library[account.xuid] || [] : [] });
      }],
      ["GET", /^\/auth\/personas$/, function () { return ok(PERSONAS); }],
      ["POST", /^\/auth\/preview$/, function (body) {
        const persona = PERSONAS.find(function (p) { return p.xuid === body.xuid; });
        if (!persona) return fail(400, "Unknown sample account.");
        state.session = persona.xuid;
        return ok({ account: state.accounts[persona.xuid] });
      }],
      ["POST", /^\/auth\/signout$/, function () { state.session = null; return ok({}); }],
      ["GET", /^\/mods$/, function () {
        return ok(Object.values(state.listings).map(publicListing).filter(Boolean)
          .sort(function (a, b) { return a.reach - b.reach || b.updated_at - a.updated_at; }));
      }],
      ["GET", /^\/mods\/([a-z0-9-]+)$/, function (body, slug) {
        const listing = state.listings[slug];
        const view = listing && publicListing(listing);
        if (!view) return fail(404, "No public mod with that name.");
        view.history = state.versions.filter(function (v) { return v.slug === slug && v.status === "approved"; })
          .sort(function (a, b) { return b.decided_at - a.decided_at; })
          .map(function (v) { return { version: v.version, notes: v.notes || "", at: v.decided_at, pulled: v.pulled, reach: v.reach,
            reviewers: v.approvals.map(function (a) { return name(a.xuid); }) }; });
        return ok(view);
      }],
      ["POST", /^\/mods\/([a-z0-9-]+)\/send$/, function (body, slug) {
        const check = core.can(me(), "send");
        if (!check.ok) return fail(401, check.reason);
        const listing = state.listings[slug];
        const view = listing && publicListing(listing);
        if (!view) return fail(404, "No public mod with that name.");
        const library = state.library[state.session] = (state.library[state.session] || []).filter(function (e) { return e.slug !== slug; });
        library.push({ slug: slug, version: view.version, sent_at: now() });
        return ok({ queued: true, game_online: state.game_online[state.session] !== false });
      }],
      ["POST", /^\/mods\/([a-z0-9-]+)\/remove$/, function (body, slug) {
        if (!me()) return fail(401, "Sign in first.");
        state.library[state.session] = (state.library[state.session] || []).filter(function (entry) { return entry.slug !== slug; });
        return ok({ removed: true });
      }],
      ["POST", /^\/mods\/([a-z0-9-]+)\/reports$/, function (body, slug) {
        const check = core.can(me(), "report");
        if (!check.ok) return fail(401, check.reason);
        const view = state.listings[slug] && publicListing(state.listings[slug]);
        if (!view) return fail(404, "No public mod with that name.");
        if (!["broken", "advantage", "malicious", "stolen", "other"].includes(body.reason)) return fail(400, "Choose a reason.");
        const details = String(body.details || "").trim();
        if (details.length < 10) return fail(400, "Describe what happened in a sentence or two.");
        state.reports.unshift({ id: "r" + (state.reports.length + 1), slug: slug, version: view.version, reporter: state.session,
          reason: body.reason, details: details.slice(0, 1000), at: now(), status: "open" });
        return ok({ received: true });
      }],
      ["GET", /^\/me\/mods$/, function () {
        if (!me()) return fail(401, "Sign in with Microsoft first.");
        return ok(state.versions.filter(function (v) { return v.creator === state.session; }).map(versionView)
          .sort(function (a, b) { return b.submitted_at - a.submitted_at; }));
      }],
      ["POST", /^\/submissions$/, function (body) {
        const check = core.can(me(), "submit");
        if (!check.ok) return fail(401, check.reason);
        let reach;
        try { reach = core.reachOf(body.grants); } catch (e) { return fail(400, e.message); }
        const errors = core.validateListing(Object.assign({}, body, { reach: reach }));
        if (Object.keys(errors).length) return { status: 422, body: { error: "Check the highlighted fields.", fields: errors } };
        const existing = state.listings[body.slug];
        if (existing && existing.creator !== state.session) return { status: 409, body: { error: "That name is taken.", fields: { slug: "Another creator owns this name." } } };
        if (state.versions.some(function (v) { return v.slug === body.slug && v.version === body.version; })) {
          return { status: 409, body: { error: "That version exists.", fields: { version: "Bump the version to submit again." } } };
        }
        if (!/^[0-9a-f]{64}$/.test(String(body.sha256 || ""))) return fail(400, "Upload the component file.");
        const gallery = Array.isArray(body.gallery) ? body.gallery : [];
        if (gallery.length > 12 || JSON.stringify(gallery).length > 2000000 || gallery.some(function (image) {
          return !image || typeof image.url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image.url)
            || image.url.length > 360000 || typeof image.caption !== 'string' || typeof image.alt !== 'string';
        })) return fail(422, "Choose a valid, bounded raster gallery.");
        const metadata = { name: body.name, summary: body.summary, description: String(body.description || '').slice(0, 40000),
          source: body.source || '', category: body.category || '', license: String(body.license || '').slice(0, 100),
          gallery: gallery.map(function (image) { return { url: image.url, caption: image.caption.slice(0, 140), alt: image.alt.slice(0, 300) }; }) };
        if (!existing) state.listings[body.slug] = Object.assign({ created_at: now(), hidden: false, creator: state.session, slug: body.slug }, metadata);
        state.counter += 1;
        const version = { listing: metadata, notes: String(body.notes || "").slice(0, 4000), id: "v" + state.counter, slug: body.slug, version: body.version, grants: body.grants || {}, reach: reach,
          status: "submitted", approvals: [], creator: state.session, sha256: body.sha256, bytes: body.bytes,
          submitted_at: now(), decided_at: null, note: "", pulled: false };
        state.versions.push(version);
        return ok(versionView(version));
      }],
      ["GET", /^\/staff\/queue$/, function () {
        return staffOnly() || ok(state.versions.filter(function (v) { return v.status === "submitted"; }).map(versionView)
          .sort(function (a, b) { return b.reach - a.reach || a.submitted_at - b.submitted_at; }));
      }],
      ["GET", /^\/staff\/versions\/(v\d+)$/, function (body, id) {
        const denied = staffOnly();
        if (denied) return denied;
        const v = state.versions.find(function (item) { return item.id === id; });
        return v ? ok(versionView(v)) : fail(404, "No such version.");
      }],
      ["POST", /^\/staff\/versions\/(v\d+)\/decision$/, function (body, id) {
        const denied = staffOnly();
        if (denied) return denied;
        const index = state.versions.findIndex(function (item) { return item.id === id; });
        if (index < 0) return fail(404, "No such version.");
        let next;
        try { next = core.decide(state.versions[index], me(), body.decision, body.note, now()); } catch (e) { return fail(403, e.message); }
        state.versions[index] = next;
        const target = next.slug + " " + next.version;
        const rule = core.approvalRule(next.reach);
        log(body.decision === "approve" ? (next.status === "approved" ? "approved" : "approved (" + next.approvals.length + " of " + rule.count + ")")
          : body.decision === "reject" ? "rejected" : "requested changes", target, body.note);
        return ok(versionView(next));
      }],
      ["POST", /^\/staff\/versions\/(v\d+)\/pull$/, function (body, id) {
        const check = core.can(me(), "pull");
        if (!check.ok) return fail(403, check.reason);
        const v = state.versions.find(function (item) { return item.id === id; });
        if (!v || v.status !== "approved") return fail(404, "Only approved versions can be pulled.");
        if (!String(body.reason || "").trim()) return fail(400, "Say why it's being pulled.");
        v.pulled = true;
        log("pulled", v.slug + " " + v.version, body.reason);
        return ok(versionView(v));
      }],
      ["POST", /^\/staff\/mods\/([a-z0-9-]+)\/hide$/, function (body, slug) {
        const check = core.can(me(), "hide");
        if (!check.ok) return fail(403, check.reason);
        const listing = state.listings[slug];
        if (!listing) return fail(404, "No such mod.");
        listing.hidden = Boolean(body.hidden);
        log(listing.hidden ? "hid listing" : "restored listing", slug, body.reason);
        return ok({ hidden: listing.hidden });
      }],
      ["GET", /^\/staff\/reports$/, function () {
        return staffOnly() || ok(state.reports.map(function (r) {
          const v = state.versions.find(function (item) { return item.slug === r.slug && item.version === r.version; });
          return Object.assign({ reporter_name: name(r.reporter), name: state.listings[r.slug].name,
            resolved_by_name: r.resolved_by ? name(r.resolved_by) : "", version_id: v && v.id, pulled: Boolean(v && v.pulled) }, r);
        }));
      }],
      ["POST", /^\/staff\/reports\/(r\d+)\/resolve$/, function (body, id) {
        const check = core.can(me(), "resolve-report");
        if (!check.ok) return fail(403, check.reason);
        const report = state.reports.find(function (r) { return r.id === id; });
        if (!report) return fail(404, "No such report.");
        if (!String(body.note || "").trim()) return fail(400, "Write what you found.");
        Object.assign(report, { status: "resolved", resolution: body.note, resolved_by: state.session });
        log("resolved report", report.slug + " " + report.version, body.note);
        return ok(report);
      }],
      ["GET", /^\/staff\/people$/, function () {
        return staffOnly() || ok(Object.values(state.accounts).filter(function (a) { return a.role !== "player"; })
          .sort(function (a, b) { return core.atLeast(b, a.role) - core.atLeast(a, b.role) || a.gamertag.localeCompare(b.gamertag); }));
      }],
      ["POST", /^\/staff\/people\/role$/, function (body) {
        const target = Object.values(state.accounts).find(function (a) { return a.gamertag.toLowerCase() === String(body.gamertag || "").trim().toLowerCase(); });
        if (!target) return fail(404, "No Cinnabar account with that gamertag has signed in yet.");
        const check = core.can(me(), "set-role", { target: target, role: body.role });
        if (!check.ok) return fail(403, check.reason);
        if (!String(body.reason || "").trim()) return fail(400, "Note why, for the audit log.");
        const before = target.role;
        target.role = body.role;
        log("changed role", target.gamertag + ": " + before + " → " + body.role, body.reason);
        return ok(target);
      }],
      ["GET", /^\/staff\/audit$/, function () {
        return staffOnly() || ok(state.audit.slice(0, 200).map(function (entry) { return Object.assign({ actor_name: name(entry.actor) }, entry); }));
      }],
    ];

    return {
      backend: "mock",
      /** Answers one request as the API would, persisting any change. */
      request: function (method, path, body) {
        const url = path.split("?")[0];
        for (const route of routes) {
          const match = route[0] === method && route[1].exec(url);
          if (match) {
            const result = route[2].apply(null, [body || {}].concat(match.slice(1)));
            save();
            return Promise.resolve(JSON.parse(JSON.stringify(result)));
          }
        }
        return Promise.resolve(fail(404, "Not found."));
      },
      /** Restores the sample data. */
      reset: function () { state = seed(now()); save(); },
      personas: PERSONAS,
    };
  }

  const exported = { createMockApi: createMockApi, PERSONAS: PERSONAS, STORAGE_KEY: STORAGE_KEY };
  if (typeof module !== "undefined") module.exports = exported;
  if (typeof window !== "undefined") window.CinnabarMarketMock = exported;
})();
