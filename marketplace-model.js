(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CinnabarMarketplace = factory();
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const textFields = ["title", "category", "summary", "description", "version"];
  const editableFields = textFields.concat(["permissions", "license"]);
  const protectedFields = ["id", "owner", "status", "creator", "slug", "tone", "icon", "createdAt", "updatedAt"];
  const externalLink = /(?:\b[a-z][a-z\d+.-]*:\/\/|\b(?:mailto|data|javascript):|www\.|\/\/[a-z\d]|\b[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,}\b)/i;

  /** Recognizes JSON objects without accepting arrays or null. */
  function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  /** Copies JSON values so callers cannot change catalog entries through a result. */
  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** Accepts caller-supplied epoch times or ISO timestamps without reading a clock. */
  function validTime(now) {
    return (typeof now === "number" && Number.isFinite(now) && now >= 0)
      || (typeof now === "string" && /^\d{4}-\d{2}-\d{2}T/.test(now) && Number.isFinite(Date.parse(now)));
  }

  /** Rejects absent or invalid mutation timestamps before changing state. */
  function requireTime(now) {
    if (!validTime(now)) throw new Error("A valid caller-supplied timestamp is required.");
  }

  /** Normalizes required plain text and rejects links in demo submission content. */
  function text(value, field) {
    if (typeof value !== "string" || !value.trim()) throw new Error(field + " is required.");
    const result = value.trim();
    if (externalLink.test(result)) throw new Error("External links are not supported in " + field + ".");
    return result;
  }

  /** Keeps only supported free submission content; identity and workflow fields are never editable. */
  function submissionFields(fields) {
    if (!object(fields)) throw new Error("Submission fields must be an object.");
    Object.keys(fields).forEach(function (key) {
      if (!editableFields.includes(key) && !protectedFields.includes(key) && key !== "price") {
        throw new Error("Unsupported submission field: " + key + ". Artifacts and external links are not supported.");
      }
    });
    if (fields.price !== undefined && fields.price !== 0
      && !(typeof fields.price === "string" && (fields.price.trim().toLowerCase() === "free"
        || (fields.price.trim() !== "" && Number(fields.price) === 0)))) {
      throw new Error("Demo submissions must be free.");
    }
    const result = {};
    textFields.forEach(function (key) { result[key] = text(fields[key], key); });
    if (!Array.isArray(fields.permissions) || !fields.permissions.length) {
      throw new Error("permissions must be a nonempty array of requested permission strings.");
    }
    result.permissions = [...new Set(Array.from(fields.permissions, function (value) { return text(value, "permission"); }))];
    if (fields.license !== undefined) result.license = text(fields.license, "license");
    return result;
  }

  /** Builds a local demo model; catalog content and policy are never included in its saved state. */
  function createModel(catalog, savedState) {
    if (!object(catalog) || !object(catalog.roles) || !Object.keys(catalog.roles).length
      || !Object.values(catalog.roles).every(function (permissions) {
        return Array.isArray(permissions) && permissions.every(function (permission) { return typeof permission === "string"; });
      }) || !Array.isArray(catalog.listings) || !Array.isArray(catalog.review_transitions)) {
      throw new Error("A valid marketplace catalog with roles, listings and review transitions is required.");
    }
    const source = copy(catalog);
    const roles = Object.keys(source.roles);
    const byId = new Map();
    source.listings.forEach(function (entry) {
      if (!object(entry) || !Number.isSafeInteger(entry.id) || entry.id < 0 || byId.has(entry.id)
        || typeof entry.owner !== "string" || typeof entry.status !== "string") {
        throw new Error("Catalog listings must have unique numeric IDs, owners and statuses.");
      }
      byId.set(entry.id, entry);
    });
    source.review_transitions.forEach(function (rule) {
      if (!object(rule) || ![rule.from, rule.to, rule.action, rule.permission].every(function (value) {
        return typeof value === "string" && value.length > 0;
      }) || !["self", "other"].includes(rule.owner) || typeof rule.requires_reason !== "boolean") {
        throw new Error("Invalid catalog review transition; requires_reason must be a boolean.");
      }
    });
    const statuses = new Set(["draft", ...source.listings.map(function (entry) { return entry.status; })]);
    source.review_transitions.forEach(function (rule) { statuses.add(rule.from); statuses.add(rule.to); });
    const staffRoles = roles.filter(function (role) {
      return source.roles[role].includes("submission.review") || source.roles[role].includes("staff.manage");
    });
    const state = {
      schemaVersion: 1,
      actorRole: roles.includes("player") ? "player" : roles[0],
      submissions: [],
      listingEdits: {},
      libraries: {},
      staff: [],
      audit: []
    };

    /** Checks role names against catalog own properties, including for directly changed demo state. */
    function knownRole(role) {
      return typeof role === "string" && Object.hasOwn(source.roles, role);
    }

    /** Derives each role's distinct demo identity without storing a second permission table. */
    function identity(role) {
      if (!knownRole(role)) throw new Error("Unknown marketplace role: " + String(role) + ".");
      return { id: role + "-demo", role: role, name: role.charAt(0).toUpperCase() + role.slice(1) + " demo" };
    }

    /** Checks the active role using the shared catalog permission policy. */
    function can(permission) {
      return knownRole(state.actorRole) && source.roles[state.actorRole].includes(permission);
    }

    /** Fails a mutation before it can change state when the active role lacks permission. */
    function requirePermission(permission) {
      identity(state.actorRole);
      if (!can(permission)) throw new Error("The current role lacks permission: " + permission + ".");
    }

    /** Produces sparse edits so unchanged catalog content follows the current catalog on reload. */
    function difference(fields, base) {
      const result = {};
      editableFields.forEach(function (key) {
        if (Object.hasOwn(fields, key) && JSON.stringify(fields[key]) !== JSON.stringify(base[key])) result[key] = copy(fields[key]);
      });
      return result;
    }

    /** Discards malformed saved records while preserving independent valid demo changes. */
    function restore(saved) {
      try { saved = typeof saved === "string" ? JSON.parse(saved) : copy(saved); }
      catch (_) { return; }
      if (!object(saved) || (saved.schemaVersion !== undefined && saved.schemaVersion !== state.schemaVersion)) return;
      if (knownRole(saved.actorRole)) state.actorRole = saved.actorRole;
      if (Array.isArray(saved.submissions)) saved.submissions.forEach(function (entry) {
        if (!object(entry) || !Number.isSafeInteger(entry.id) || entry.id < 1000 || byId.has(entry.id)
          || state.submissions.some(function (existing) { return existing.id === entry.id; })
          || typeof entry.owner !== "string" || !/^.+-demo$/.test(entry.owner)
          || !statuses.has(entry.status) || !validTime(entry.createdAt) || !validTime(entry.updatedAt)) return;
        try {
          const fields = {};
          editableFields.forEach(function (key) { if (Object.hasOwn(entry, key)) fields[key] = entry[key]; });
          state.submissions.push(Object.assign(submissionFields(fields), {
            id: entry.id, owner: entry.owner, status: entry.status,
            createdAt: entry.createdAt, updatedAt: entry.updatedAt
          }));
        } catch (_) { /* A damaged submission does not discard other saved demo state. */ }
      });
      if (object(saved.listingEdits)) Object.entries(saved.listingEdits).forEach(function ([id, edit]) {
        const base = byId.get(Number(id));
        if (!base || String(base.id) !== id || !object(edit)) return;
        const result = {};
        if (statuses.has(edit.status) && edit.status !== base.status) result.status = edit.status;
        if (validTime(edit.updatedAt)) result.updatedAt = edit.updatedAt;
        if (object(edit.fields)) {
          try {
            const fields = {};
            editableFields.forEach(function (key) {
              if (Object.hasOwn(edit.fields, key)) fields[key] = edit.fields[key];
            });
            result.fields = difference(submissionFields(Object.assign({}, base, fields)), base);
          } catch (_) { /* Ignore malformed field edits independently of valid status edits. */ }
        }
        if (Object.keys(result).length) state.listingEdits[id] = result;
      });
      if (object(saved.libraries)) roles.forEach(function (role) {
        const id = identity(role).id;
        if (Array.isArray(saved.libraries[id])) state.libraries[id] = [...new Set(saved.libraries[id].filter(function (listingId) {
          return byId.has(listingId) || state.submissions.some(function (entry) { return entry.id === listingId; });
        }))];
      });
      if (Array.isArray(saved.staff)) saved.staff.forEach(function (member) {
        if (!object(member) || typeof member.id !== "string" || !member.id.trim() || !staffRoles.includes(member.role)
          || !validTime(member.updatedAt) || state.staff.some(function (existing) { return existing.id === member.id.trim(); })) return;
        state.staff.push({ id: member.id.trim(), role: member.role, updatedAt: member.updatedAt });
      });
      if (Array.isArray(saved.audit)) saved.audit.forEach(function (entry) {
        if (!object(entry) || !validTime(entry.at) || typeof entry.actorRole !== "string" || !entry.actorRole.trim()
          || entry.actorId !== entry.actorRole + "-demo" || typeof entry.action !== "string" || !entry.action.trim()
          || !(typeof entry.target === "string" && entry.target.trim() || Number.isSafeInteger(entry.target))
          || typeof entry.reason !== "string"
          || ![entry.previousStatus, entry.newStatus].every(function (status) { return status === null || statuses.has(status); })
          || ![entry.previousRole, entry.newRole].every(function (role) {
            return role === null || (typeof role === "string" && role.trim().length > 0);
          })) return;
        state.audit.push({ at: entry.at, actorId: entry.actorId, actorRole: entry.actorRole,
          action: entry.action, target: entry.target, reason: entry.reason,
          previousStatus: entry.previousStatus, newStatus: entry.newStatus,
          previousRole: entry.previousRole, newRole: entry.newRole });
      });
    }

    /** Derives display entries from source content plus local submission and workflow edits. */
    function listings() {
      const entries = source.listings.map(function (entry) {
        const edit = state.listingEdits[entry.id] || {};
        return Object.assign({}, entry, edit.fields, edit.status ? { status: edit.status } : {},
          edit.updatedAt !== undefined ? { updatedAt: edit.updatedAt } : {});
      });
      state.submissions.forEach(function (entry) {
        const template = source.listings.find(function (base) { return base.category === entry.category; }) || source.listings[0] || {};
        const role = roles.find(function (role) { return identity(role).id === entry.owner; });
        entries.push(Object.assign({ slug: "submission-" + entry.id, creator: role ? identity(role).name : "Demo creator",
          tone: template.tone, icon: template.icon, price: 0 }, entry));
      });
      return copy(entries);
    }

    /** Finds one listing without allowing strings to alias numeric listing IDs. */
    function listing(id) {
      const entry = listings().find(function (candidate) { return candidate.id === id; });
      if (!entry) throw new Error("Unknown marketplace listing: " + String(id) + ".");
      return entry;
    }

    /** Returns the current actor's selected listing IDs as an independent array. */
    function library() {
      return (state.libraries[identity(state.actorRole).id] || []).slice();
    }

    /** Appends a deterministic record of a successful mutation. */
    function record(action, target, reason, now, changes) {
      const actor = identity(state.actorRole);
      state.audit.push(Object.assign({ at: now, actorId: actor.id, actorRole: actor.role, action: action,
        target: target, reason: reason, previousStatus: null, newStatus: null, previousRole: null, newRole: null }, changes));
    }

    /** Updates only the status and timestamp of an existing source or synthetic listing. */
    function updateStatus(entry, status, now) {
      const synthetic = state.submissions.find(function (candidate) { return candidate.id === entry.id; });
      if (synthetic) Object.assign(synthetic, { status: status, updatedAt: now });
      else {
        const edit = state.listingEdits[entry.id] || {};
        state.listingEdits[entry.id] = Object.assign({}, edit, { status: status, updatedAt: now });
      }
    }

    /** Selects catalog transition rules by status, role permission and actor ownership. */
    function transitions(id) {
      const entry = listing(id);
      const actor = identity(state.actorRole);
      return copy(source.review_transitions.filter(function (rule) {
        return rule.from === entry.status && can(rule.permission)
          && (rule.owner === "self" ? entry.owner === actor.id : entry.owner !== actor.id);
      }));
    }

    /** Requires a meaningful audit reason for review and staff decisions. */
    function reasonText(reason) {
      if (typeof reason !== "string" || !reason.trim()) throw new Error("A nonempty reason is required.");
      return reason.trim();
    }

    /** Filters discovery or selected library content by the same text and category fields. */
    function search(query, category, libraryOnly, includeUnavailable = false) {
      const words = typeof query === "string" ? query.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
      const selected = libraryOnly ? library() : null;
      return listings().filter(function (entry) {
        const haystack = [entry.title, entry.creator, entry.category, entry.summary, entry.description,
          ...(entry.permissions || [])].join(" ").toLowerCase();
        return (entry.status === "published" || (selected && includeUnavailable))
          && (!category || category === "all" || entry.category === category)
          && (!selected || selected.includes(entry.id)) && words.every(function (word) { return haystack.includes(word); });
      });
    }

    restore(savedState);
    return {
      state: state,
      roles: roles.slice(),
      get actor() { return identity(state.actorRole); },
      can: can,
      /** Switches demo identities only to roles defined by the current catalog. */
      setRole: function (role) {
        identity(role);
        state.actorRole = role;
        return identity(role);
      },
      listings: listings,
      library: library,
      /** Adds published listings or removes existing selections for the current actor. */
      toggleLibrary: function (id, now) {
        requirePermission("library.add");
        requireTime(now);
        const entry = listing(id);
        const actor = identity(state.actorRole);
        const ids = library();
        const removing = ids.includes(id);
        if (!removing && entry.status !== "published") throw new Error("Only published listings can be added to the library.");
        state.libraries[actor.id] = removing ? ids.filter(function (candidate) { return candidate !== id; }) : ids.concat([id]);
        record(removing ? "library.remove" : "library.add", id, "", now);
        return library();
      },
      /** Creates a draft or edits the current creator's draft or requested revision. */
      saveSubmission: function (fields, now, existingId) {
        requirePermission(existingId === undefined ? "submission.create" : "submission.edit_own");
        requireTime(now);
        const actor = identity(state.actorRole);
        const existing = existingId === undefined ? null : listing(existingId);
        if (existing && existing.owner !== actor.id) throw new Error("Creators can edit only their own submissions.");
        if (existing && !["draft", "changes_requested"].includes(existing.status)) {
          throw new Error("Only draft or changes_requested submissions can be edited.");
        }
        const values = submissionFields(fields);
        if (!existing) {
          const max = listings().reduce(function (highest, entry) { return Math.max(highest, entry.id); }, 999);
          if (max >= Number.MAX_SAFE_INTEGER) throw new Error("No safe numeric listing ID is available.");
          const entry = Object.assign({}, values, { id: max + 1, owner: actor.id, status: "draft", createdAt: now, updatedAt: now });
          state.submissions.push(entry);
          record("submission.create", entry.id, "", now, { newStatus: entry.status });
          return listing(entry.id);
        }
        const synthetic = state.submissions.find(function (entry) { return entry.id === existing.id; });
        if (synthetic) Object.assign(synthetic, values, { updatedAt: now });
        else {
          state.listingEdits[existing.id] = Object.assign({}, state.listingEdits[existing.id], {
            fields: difference(values, byId.get(existing.id)), updatedAt: now
          });
        }
        record("submission.edit", existing.id, "", now, { previousStatus: existing.status, newStatus: existing.status });
        return listing(existing.id);
      },
      transitions: transitions,
      /** Applies an allowed catalog rule and records the supplied review reason. */
      transition: function (id, action, reason, now) {
        requireTime(now);
        const entry = listing(id);
        const rule = transitions(id).find(function (candidate) { return candidate.action === action; });
        if (!rule) throw new Error("Transition " + String(action) + " is not permitted for this actor, owner and listing status.");
        const explanation = rule.requires_reason ? reasonText(reason) : (typeof reason === "string" ? reason.trim() : "");
        updateStatus(entry, rule.to, now);
        record(action, id, explanation, now, { previousStatus: entry.status, newStatus: rule.to });
        return listing(id);
      },
      /** Grants a catalog-derived staff role or removes another demo staff assignment with a reason. */
      manageStaff: function (id, role, reason, now) {
        requirePermission("staff.manage");
        requireTime(now);
        if (typeof id !== "string" || !id.trim()) throw new Error("A staff member ID is required.");
        id = id.trim();
        if (id === identity(state.actorRole).id) throw new Error("You cannot manage your own staff assignment.");
        if (role !== null && (!knownRole(role) || !staffRoles.includes(role))) throw new Error("A known staff role with review or staff permissions is required.");
        const explanation = reasonText(reason);
        const previous = state.staff.find(function (member) { return member.id === id; });
        if (role === null && !previous) throw new Error("No staff assignment exists for " + id + ".");
        if (previous && previous.role === role) throw new Error("The staff member already has this role.");
        state.staff = state.staff.filter(function (member) { return member.id !== id; });
        if (role !== null) state.staff.push({ id: id, role: role, updatedAt: now });
        record(role === null ? "staff.remove" : "staff.grant", id, explanation, now,
          { previousRole: previous ? previous.role : null, newRole: role });
        return copy(state.staff);
      },
      /** Returns independent staff assignments for the local demo. */
      staff: function () { return copy(state.staff); },
      /** Returns independent audit records in mutation order. */
      audit: function () { return copy(state.audit); },
      /** Exports mutable JSON demo state without catalog entries or permission policy. */
      exportState: function () { return copy(state); },
      /** Searches published content, optionally within the current actor's library. */
      search: function (query, category, libraryOnly) {
        return search(query, category, libraryOnly);
      },
      /** Projects selected library entries, including unavailable selections that remain removable. */
      libraryEntries: function (query, category) {
        return search(query, category, true, true);
      }
    };
  }

  return { createModel: createModel };
}));
