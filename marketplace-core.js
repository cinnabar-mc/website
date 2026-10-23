(function () {
  "use strict";

  /** Reach levels, ordered from least to most of the player's game a mod can touch. */
  const RUNGS = [
    { id: "looks", label: "Looks", summary: "Changes how your game looks" },
    { id: "reads", label: "Reads", summary: "Reads your game and world state" },
    { id: "watches", label: "Watches", summary: "Sees other players and hidden things" },
    { id: "acts", label: "Acts", summary: "Acts for you: input, aim, commands" },
    { id: "network", label: "Network", summary: "Sees or changes network traffic" },
  ];

  /**
   * Mirrors the client's `ModGrants` descriptors (crates/mod-host/src/grants.rs on dev):
   * grant name, the client's label, its sensitive flag, and the rung the marketplace files it under.
   * Replace with a pinned client input once the client exports this table as data.
   */
  const CAPABILITIES = [
    ["environment", "Environment", false, 0, "Replaces visual time and local menu branding."],
    ["hud", "HUD", false, 0, "Draws bounded HUD cards and a custom crosshair."],
    ["settings", "Settings file", false, 0, "Keeps its own small settings file."],
    ["render", "Rendering", false, 0, "Adds sandboxed post passes and world primitives."],
    ["world_draw", "World drawing", false, 0, "Draws bounded retained world geometry."],
    ["render_material", "Drawing materials", false, 0, "Uses bounded procedural drawing materials."],
    ["render_post", "Post effects", false, 0, "Adds sandboxed scene post effects."],
    ["render_depth", "Scene depth", false, 0, "Lets render passes read scene depth."],
    ["fullbright", "Fullbright", false, 0, "Lights your view fully, without changing server light."],
    ["terrain", "Terrain", false, 1, "Reads bounded regions and block properties."],
    ["player_state", "Player status", false, 1, "Reads your inventory and status effects."],
    ["entities", "Entities", false, 1, "Reads nearby non-player actors."],
    ["items", "Items", false, 1, "Reads the session's items."],
    ["recipes", "Recipes", false, 1, "Reads the session's recipes."],
    ["screen", "Screens", false, 1, "Shows an overlay beside container screens."],
    ["players", "Player poses", false, 2, "Reads other players' and the camera's pose."],
    ["entity_observe", "Entity observation", false, 2, "Observes session-authorized actors."],
    ["entity_highlight", "Entity highlights", false, 2, "Draws attached to authorized actors."],
    ["block_highlights", "Block highlights", false, 2, "Highlights matching loaded blocks."],
    ["render_through_walls", "Through walls", false, 2, "Draws above walls and reads protected observations."],
    ["camera", "Camera rotation", true, 3, "Rotates your camera within bounds."],
    ["controls", "Controls", true, 3, "Reads key presses and reserves bindings."],
    ["keys", "Keys", true, 3, "Delivers the package's declared keys."],
    ["item_use", "Item use", true, 3, "Uses items in the air after slot changes."],
    ["movement", "Movement", true, 3, "Reads physics and requests jumps."],
    ["interaction", "Attack reach", true, 3, "Requests attacks within bounded range."],
    ["inventory", "Inventory requests", true, 3, "Takes creative items and fills recipes."],
    ["commands", "Commands", true, 3, "Runs the named commands."],
    ["packet_delay", "Packet delay", true, 4, "Delays packets after login, within bounds."],
    ["packets", "Session packets", true, 4, "Sees and changes every session packet."],
    ["wasi", "WASI runtime", false, 4, "Uses clocks, randomness and captured output."],
  ].map(function (row) {
    return { name: row[0], label: row[1], sensitive: row[2], rung: row[3], description: row[4] };
  });
  const BY_NAME = new Map(CAPABILITIES.map(function (cap) { return [cap.name, cap]; }));

  /** Lists the granted capability names in a `cinnabar:grants`-shaped object, rejecting unknown ones. */
  function requestedCapabilities(grants) {
    if (grants == null) return [];
    if (typeof grants !== "object" || Array.isArray(grants)) throw new Error("Grants must be an object");
    return Object.keys(grants).filter(function (name) {
      if (!BY_NAME.has(name)) throw new Error("Unknown capability: " + name);
      const value = grants[name];
      if (name === "commands") {
        if (!Array.isArray(value) || value.some(function (c) { return typeof c !== "string" || !c; })) {
          throw new Error("Commands must be a list of names");
        }
        return value.length > 0;
      }
      if (typeof value !== "boolean") throw new Error(name + " must be true or false");
      return value;
    });
  }

  /** Returns the highest rung any requested capability reaches; a mod asking for nothing sits on Looks. */
  function reachOf(grants) {
    return requestedCapabilities(grants).reduce(function (top, name) {
      return Math.max(top, BY_NAME.get(name).rung);
    }, 0);
  }

  /** Compares two grant requests and names what a new version adds and drops. */
  function grantDiff(previous, next) {
    const before = new Set(requestedCapabilities(previous));
    const after = new Set(requestedCapabilities(next));
    return {
      added: Array.from(after).filter(function (name) { return !before.has(name); }),
      removed: Array.from(before).filter(function (name) { return !after.has(name); }),
      kept: Array.from(after).filter(function (name) { return before.has(name); }),
    };
  }

  const ROLE_RANK = { player: 0, moderator: 1, admin: 2, owner: 3 };

  /** Approval rule for a reach: how many distinct staff approvals, and whether one must be an admin. */
  function approvalRule(reach) {
    if (reach >= 4) return { count: 2, admin: true };
    if (reach === 3) return { count: 1, admin: true };
    return { count: 1, admin: false };
  }

  /** Whether an account's role is at least the named role. */
  function atLeast(actor, role) {
    return Boolean(actor) && (ROLE_RANK[actor.role] || 0) >= ROLE_RANK[role];
  }

  /**
   * Decides whether an actor may perform an action. Returns `{ ok, reason }` so interfaces can
   * explain a disabled control. The API is the authority; the site uses this only to label controls.
   */
  function can(actor, action, context) {
    const ctx = context || {};
    const deny = function (reason) { return { ok: false, reason: reason }; };
    if (!actor) return deny("Sign in with Microsoft first.");
    if (actor.suspended && action !== "report") return deny("Your account is suspended.");
    switch (action) {
      case "send":
      case "report":
      case "submit":
        return { ok: true };
      case "review": {
        if (!atLeast(actor, "moderator")) return deny("Only staff review mods.");
        const version = ctx.version;
        if (version.creator === actor.xuid) return deny("You can't review your own mod.");
        if (version.status !== "submitted") return deny("This version isn't waiting for review.");
        if (version.approvals.some(function (a) { return a.xuid === actor.xuid; })) {
          return deny("You've already approved this version.");
        }
        return { ok: true };
      }
      case "approve": {
        const allowed = can(actor, "review", ctx);
        if (!allowed.ok) return allowed;
        const rule = approvalRule(ctx.version.reach);
        const hasAdmin = ctx.version.approvals.some(function (a) { return a.admin; });
        const last = ctx.version.approvals.length + 1 >= rule.count;
        if (rule.admin && last && !hasAdmin && !atLeast(actor, "admin")) {
          return deny(RUNGS[ctx.version.reach].label + " mods need an admin's approval.");
        }
        return { ok: true };
      }
      case "hide":
      case "resolve-report":
        return atLeast(actor, "moderator") ? { ok: true } : deny("Only staff can do this.");
      case "pull":
      case "suspend":
        return atLeast(actor, "admin") ? { ok: true } : deny("Only admins can do this.");
      case "set-role": {
        const target = ctx.target;
        const role = ctx.role;
        if (!atLeast(actor, "admin")) return deny("Only admins manage staff.");
        if (target && target.xuid === actor.xuid) return deny("You can't change your own role.");
        if (!(role in ROLE_RANK) || role === "owner") return deny("Owners are set in the API's configuration.");
        if (target && target.role === "owner") return deny("Owners are set in the API's configuration.");
        const needed = role === "admin" || (target && target.role === "admin") ? "owner" : "admin";
        return atLeast(actor, needed) ? { ok: true } : deny("Only the owner manages admins.");
      }
      default:
        return deny("Unknown action.");
    }
  }

  /**
   * Applies a review decision to a submitted version and returns the next version.
   * Approvals accumulate until the reach's rule is met; any rejection or change request ends review.
   */
  function decide(version, actor, decision, note, at) {
    const check = can(actor, decision === "approve" ? "approve" : "review", { version: version });
    if (!check.ok) throw new Error(check.reason);
    if ((decision === "reject" || decision === "changes") && !String(note || "").trim()) {
      throw new Error("Tell the creator why.");
    }
    const next = Object.assign({}, version, { approvals: version.approvals.slice() });
    if (decision === "approve") {
      next.approvals.push({ xuid: actor.xuid, admin: atLeast(actor, "admin"), at: at });
      const rule = approvalRule(version.reach);
      const hasAdmin = next.approvals.some(function (a) { return a.admin; });
      if (next.approvals.length >= rule.count && (!rule.admin || hasAdmin)) {
        next.status = "approved";
        next.decided_at = at;
      }
    } else if (decision === "reject") {
      next.status = "rejected";
      next.decided_at = at;
    } else if (decision === "changes") {
      next.status = "changes";
      next.decided_at = at;
    } else {
      throw new Error("Unknown decision.");
    }
    next.note = note || next.note || "";
    return next;
  }

  /** Validates the listing fields a creator submits with an upload. */
  function validateListing(fields) {
    const errors = {};
    const slug = String(fields.slug || "");
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) {
      errors.slug = "Use 3–40 lowercase letters, numbers and dashes.";
    }
    if (!String(fields.name || "").trim() || String(fields.name).length > 64) errors.name = "Name it in 64 characters or fewer.";
    const summary = String(fields.summary || "").trim();
    if (summary.length < 10 || summary.length > 140) errors.summary = "Summarise it in 10–140 characters.";
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(fields.version || ""))) {
      errors.version = "Use a SemVer version such as 1.0.0.";
    }
    const source = String(fields.source || "");
    if (source && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(source)) {
      errors.source = "Link the GitHub repository, like https://github.com/you/mod.";
    }
    if (fields.reach >= 3 && !source) errors.source = "Mods that act for players or touch the network must link their source.";
    return errors;
  }

  /** Reads the marketplace route from a location hash such as `#/mod/zoom` or `#/staff/queue`. */
  function parseRoute(hash) {
    const parts = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const views = ["mod", "submit", "mine", "staff"];
    if (!parts.length || !views.includes(parts[0])) return { view: "catalogue" };
    if (parts[0] === "mod") return parts[1] ? { view: "mod", slug: parts[1] } : { view: "catalogue" };
    if (parts[0] === "staff") {
      const tabs = ["queue", "reports", "people", "audit"];
      const tab = tabs.includes(parts[1]) ? parts[1] : "queue";
      return { view: "staff", tab: tab, id: tab === "queue" ? parts[2] : undefined };
    }
    return { view: parts[0] };
  }

  /** Filters listings by text and rung, keeping the API's order within each rung. */
  function filterMods(mods, query, rung) {
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    return mods.filter(function (mod) {
      if (rung != null && rung !== "" && mod.reach !== Number(rung)) return false;
      const haystack = [mod.name, mod.summary, mod.creator_name].concat(mod.capabilities).join(" ").toLowerCase();
      return terms.every(function (term) { return haystack.includes(term); });
    });
  }

  /** Reads unsigned LEB128 at an offset, returning the value and the next offset. */
  function leb(bytes, offset) {
    let value = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      if (offset >= bytes.length) throw new Error("Truncated file");
      const byte = bytes[offset++];
      value += (byte & 0x7f) * Math.pow(2, shift);
      if (!(byte & 0x80)) return [value, offset];
      shift += 7;
    }
    throw new Error("Malformed length");
  }

  /**
   * Reads a component's top-level custom sections without instantiating it: the standard
   * metadata fields and the `cinnabar:grants` request. Mirrors the client's declarations parser.
   */
  function readComponent(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      throw new Error("This isn't a WebAssembly file.");
    }
    if (!(bytes[4] === 0x0d && bytes[6] === 0x01)) throw new Error("This is a core module. Package it as a component first.");
    const text = new TextDecoder("utf-8", { fatal: true });
    const found = { name: "", description: "", version: "", authors: "", licenses: "", grants: null, grantsDeclared: false };
    let offset = 8;
    while (offset < bytes.length) {
      const id = bytes[offset];
      const header = leb(bytes, offset + 1);
      const end = header[1] + header[0];
      if (end > bytes.length) throw new Error("Truncated file");
      if (id === 0) {
        const nameLength = leb(bytes, header[1]);
        const nameEnd = nameLength[1] + nameLength[0];
        const name = text.decode(bytes.subarray(nameLength[1], nameEnd));
        const data = bytes.subarray(nameEnd, end);
        if (["description", "version", "authors", "licenses"].includes(name)) found[name] = text.decode(data).slice(0, 512);
        if (name === "component-name" && data[0] === 0) {
          const size = leb(data, 1);
          const length = leb(data, size[1]);
          found.name = text.decode(data.subarray(length[1], length[1] + length[0])).slice(0, 64);
        }
        if (name === "cinnabar:grants") {
          if (data.length > 16 * 1024) throw new Error("The grants section is over 16 KiB.");
          found.grants = JSON.parse(text.decode(data));
          found.grantsDeclared = true;
          requestedCapabilities(found.grants);
        }
      }
      offset = end;
    }
    return found;
  }

  const api = {
    RUNGS: RUNGS, CAPABILITIES: CAPABILITIES, capability: function (name) { return BY_NAME.get(name); },
    requestedCapabilities: requestedCapabilities, reachOf: reachOf, grantDiff: grantDiff,
    approvalRule: approvalRule, can: can, decide: decide, validateListing: validateListing,
    parseRoute: parseRoute, filterMods: filterMods, readComponent: readComponent, atLeast: atLeast,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.CinnabarMarket = api;
})();
