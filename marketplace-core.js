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

  // Presentation groups only. Labels, types and sensitivity come from the pinned client.
  const groups = [
    ['environment', 'hud', 'settings', 'render', 'world_draw', 'render_material', 'render_post', 'render_depth', 'fullbright'],
    ['terrain', 'player_state', 'entities', 'items', 'recipes', 'screen'],
    ['players', 'entity_observe', 'entity_highlight', 'block_highlights', 'render_through_walls'],
    ['camera', 'controls', 'keys', 'item_use', 'movement', 'interaction', 'inventory', 'commands'],
  ];
  const descriptors = typeof module !== 'undefined' && module.exports
    ? require('./dist/marketplace-capabilities.js') : window.CinnabarCapabilities;
  const CAPABILITIES = descriptors.map(function (cap) {
    const rung = groups.findIndex(function (names) { return names.includes(cap.name); });
    return Object.assign({}, cap, { rung: rung < 0 ? 4 : rung });
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
        if (!Array.isArray(value) || Array.from(value).some(function (c) { return typeof c !== "string" || !c; })) {
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
    const oldCommands = new Set((previous && previous.commands) || []);
    const newCommands = new Set((next && next.commands) || []);
    const commands = {
      added: Array.from(newCommands).filter(function (name) { return !oldCommands.has(name); }).sort(),
      removed: Array.from(oldCommands).filter(function (name) { return !newCommands.has(name); }).sort(),
    };
    const added = Array.from(after).filter(function (name) { return !before.has(name); });
    return {
      added: added,
      removed: Array.from(before).filter(function (name) { return !after.has(name); }),
      kept: Array.from(after).filter(function (name) { return before.has(name); }),
      changed: before.has('commands') && after.has('commands') && (commands.added.length || commands.removed.length) ? ['commands'] : [],
      commands: commands,
      expanded: Boolean(added.length || commands.added.length),
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
    return Boolean(actor) && Object.hasOwn(ROLE_RANK, actor.role) && Object.hasOwn(ROLE_RANK, role) && ROLE_RANK[actor.role] >= ROLE_RANK[role];
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
        if (!Object.hasOwn(ROLE_RANK, role) || role === "owner") return deny("Owners are set in the API's configuration.");
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
    if (typeof fields.description !== "undefined" && (typeof fields.description !== "string" || fields.description.length > 40000)) errors.description = "Keep the description under 40,000 characters.";
    const source = String(fields.source || "");
    if (source && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(source)) {
      errors.source = "Link the GitHub repository, like https://github.com/you/mod.";
    }
    if (fields.reach >= 3 && !source) errors.source = "Mods that act for players or touch the network must link their source.";
    return errors;
  }

  /** Reads the marketplace route from a location hash such as `#/mod/zoom` or `#/staff/queue`. */
  function parseRoute(hash) {
    const parts = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean).map(function (part) { try { return decodeURIComponent(part); } catch (_) { return ""; } });
    const views = ["mod", "submit", "mine", "staff", "library"];
    if (!parts.length || !views.includes(parts[0])) return { view: "catalogue" };
    if (parts[0] === "mod") return parts[1] ? { view: "mod", slug: parts[1] } : { view: "catalogue" };
    if (parts[0] === "staff") {
      const tabs = ["queue", "reports", "people", "audit"];
      const tab = tabs.includes(parts[1]) ? parts[1] : "queue";
      return { view: "staff", tab: tab, id: tab === "queue" ? parts[2] : undefined };
    }
    if (parts[0] === "mine") return { view: "mine", id: parts[1] };
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

  /** Read a bounded u32 LEB without crossing the containing section. */
  function leb(bytes, offset, end) {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (offset >= end) throw new Error("Truncated length.");
      const byte = bytes[offset++];
      if (i === 4 && byte > 15) throw new Error("Malformed length.");
      value += (byte & 127) * Math.pow(2, i * 7);
      if (!(byte & 128)) return [value, offset];
    }
    throw new Error("Malformed length.");
  }

  /** Reject duplicate top-level permission keys, including escaped spellings. */
  function parseGrants(value) {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Grants must be an object.");
    const tokens = value.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]/g) || [];
    const seen = new Set();
    let depth = 0;
    tokens.forEach(function (token, index) {
      if (token === "{" || token === "[") depth++;
      else if (token === "}" || token === "]") depth--;
      else if (depth === 1 && token[0] === '"' && tokens[index + 1] === ":") {
        const name = JSON.parse(token);
        if (seen.has(name)) throw new Error("Duplicate capability: " + name);
        seen.add(name);
      }
    });
    requestedCapabilities(parsed);
    return parsed;
  }

  /**
   * Read strictly framed top-level declarations. Full component/type/code validation
   * additionally runs in the trusted worker; this reader never executes an upload.
   */
  function readComponent(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length > 16 * 1024 * 1024) throw new Error("The file is over 16 MiB.");
    if (bytes.length < 8 || [0, 97, 115, 109].some(function (v, i) { return bytes[i] !== v; })) {
      throw new Error("This isn't a WebAssembly file.");
    }
    if ([1, 0, 0, 0].every(function (v, i) { return bytes[i + 4] === v; })) {
      throw new Error("This is a core module. Package it as a component first.");
    }
    if (![13, 0, 1, 0].every(function (v, i) { return bytes[i + 4] === v; })) throw new Error("Invalid component header.");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const found = { name: "", description: "", version: "", authors: "", licenses: "", grants: null, grantsDeclared: false };
    const seen = new Set();
    let offset = 8;
    while (offset < bytes.length) {
      const id = bytes[offset++];
      if (id > 11) throw new Error("Unknown component section.");
      const [size, start] = leb(bytes, offset, bytes.length);
      const end = start + size;
      if (end > bytes.length) throw new Error("Truncated section.");
      if (id === 0) {
        const [length, nameStart] = leb(bytes, start, end);
        const nameEnd = nameStart + length;
        if (nameEnd > end) throw new Error("Truncated section name.");
        const name = decoder.decode(bytes.subarray(nameStart, nameEnd));
        const recognized = ["component-name", "description", "version", "authors", "licenses", "cinnabar:grants"].includes(name);
        if (recognized && seen.has(name)) throw new Error("Duplicate metadata section: " + name);
        if (recognized) seen.add(name);
        const data = bytes.subarray(nameEnd, end);
        if (["description", "version", "authors", "licenses"].includes(name)) {
          if (data.length > 65536) throw new Error("Metadata section is too large.");
          found[name] = decoder.decode(data);
        }
        if (name === "component-name") {
          let cursor = 0;
          let named = false;
          while (cursor < data.length) {
            const sub = data[cursor++];
            const [subSize, subStart] = leb(data, cursor, data.length);
            const subEnd = subStart + subSize;
            if (subEnd > data.length) throw new Error("Truncated component name.");
            if (sub === 0) {
              if (named) throw new Error("Duplicate component name.");
              named = true;
              const [count, at] = leb(data, subStart, subEnd);
              if (at + count !== subEnd) throw new Error("Malformed component name.");
              found.name = decoder.decode(data.subarray(at, subEnd));
            }
            cursor = subEnd;
          }
        }
        if (name === "cinnabar:grants") {
          if (data.length > 16384) throw new Error("The grants section is over 16 KiB.");
          found.grants = parseGrants(decoder.decode(data));
          found.grantsDeclared = true;
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
