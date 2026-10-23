(function () {
  "use strict";

  const M = window.CinnabarMarket;
  const config = (window.CINNABAR_DOWNLOADS || {}).marketplace || { backend: "mock" };
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const search = document.getElementById("search");
  const SVG = "http://www.w3.org/2000/svg";
  const ICONS = {
    send: "M8 2h4v7h4l-6 6-6-6h4zM3 15h3v2h8v-2h3v5H3z",
    flag: "M4 2h2v16H4zm2 1h9l-2 3 2 3H6z",
    back: "M8 4h2v2H8v2h8v4H8v2h2v2H8v-2H6v-2H4V8h2V6h2z",
    upload: "M8 15h4V8h4l-6-6-6 6h4zM3 15h3v2h8v-2h3v5H3z",
    check: "M3 10h2v2h2v2h2v-2h2v-2h2V8h2V6h2v2h-2v2h-2v2h-2v2H9v2H7v-2H5v-2H3z",
    link: "M11 3h6v6h-2V6.4l-6 6L7.6 11l6-6H11zM3 5h6v2H5v8h8v-4h2v6H3z",
  };

  /** Builds an element from a tag, attributes and children, never parsing strings as HTML. */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(function ([key, value]) {
      if (value === false || value == null) return;
      if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "dataset") Object.assign(el.dataset, value);
      else el.setAttribute(key, value === true ? "" : value);
    });
    children.flat(Infinity).forEach(function (child) {
      if (child == null || child === false) return;
      el.append(child instanceof Node ? child : String(child));
    });
    return el;
  }

  /** Draws one of the site's pixel icons. */
  function icon(name) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("class", "i");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", ICONS[name]);
    svg.append(path);
    return svg;
  }

  /** The five-cell reach meter: the marketplace's signature glyph. */
  function reachGlyph(reach, large) {
    const meter = h("span", { class: "reach" + (large ? " large" : ""), "data-reach": reach, "aria-hidden": "true" });
    for (let i = 4; i >= 0; i--) meter.append(h("i", { class: i <= reach ? "on" : "" }));
    return meter;
  }

  /** A deterministic pixel icon for listings that don't ship their own. */
  function modIcon(slug, reach) {
    let seed = 0;
    for (const ch of slug) seed = Math.imul(seed ^ ch.charCodeAt(0), 2654435761) >>> 0;
    const colors = ["#95c783", "#c3d38a", "#e6d7a8", "#f0a868", "#f27a63"];
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("class", "mod-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("shape-rendering", "crispEdges");
    const add = function (x, y, fill) {
      const r = document.createElementNS(SVG, "rect");
      r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", 1); r.setAttribute("height", 1); r.setAttribute("fill", fill);
      svg.append(r);
    };
    const ground = document.createElementNS(SVG, "rect");
    ground.setAttribute("width", 8); ground.setAttribute("height", 8); ground.setAttribute("fill", "#253025");
    svg.append(ground);
    for (let y = 1; y < 7; y++) {
      for (let x = 1; x < 4; x++) {
        seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0;
        if (seed % 5 < 2) continue;
        const fill = seed % 7 === 0 ? "#edf2eb" : colors[reach];
        add(x, y, fill); add(7 - x, y, fill);
      }
    }
    return svg;
  }

  /** A capability chip, coloured by the rung it sits on. */
  function chip(name) {
    const cap = M.capability(name);
    return h("span", { class: "chip" + (cap.sensitive ? " sensitive" : ""), "data-reach": cap.rung, title: cap.description }, cap.label);
  }

  /** Human-readable relative time. */
  function ago(at) {
    const minutes = Math.max(1, Math.round((Date.now() - at) / 60000));
    if (minutes < 60) return minutes + " min ago";
    const hours = Math.round(minutes / 60);
    if (hours < 36) return hours + (hours === 1 ? " hour ago" : " hours ago");
    const days = Math.round(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  function waited(at) {
    const minutes = Math.max(1, Math.round((Date.now() - at) / 60000));
    return minutes < 60 ? minutes + "m" : minutes < 2880 ? Math.round(minutes / 60) + "h" : Math.round(minutes / 1440) + "d";
  }

  function ruleText(reach) {
    const rule = M.approvalRule(reach);
    return rule.count === 2 ? "Two staff approvals, one an admin" : rule.admin ? "Approved by an admin" : "Approved by staff";
  }

  function toast(message) {
    toastEl.textContent = message;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(function () { toastEl.textContent = ""; }, 6000);
  }

  const backend = config.backend === "http" && config.api_url
    ? window.CinnabarMarketHttp.createHttpApi(config.api_url.replace(/\/$/, ""), window.fetch.bind(window), window.location)
    : window.CinnabarMarketMock.createMockApi(window.localStorage);
  let session = { account: null, game_online: false, library: [] };
  let queueCount = 0;
  let renderToken = 0;

  async function call(method, path, body) {
    try {
      return await backend.request(method, path, body);
    } catch (error) {
      return { status: 0, body: { error: "Can't reach the marketplace. Check your connection and try again." } };
    }
  }

  /** Refreshes the signed-in account and redraws the header controls that depend on it. */
  async function loadSession() {
    const result = await call("GET", "/me");
    session = result.status === 200 ? result.body : { account: null, game_online: false, library: [] };
    const account = session.account;
    const staff = M.atLeast(account, "moderator");
    document.getElementById("staff-link").hidden = !staff;
    if (staff) {
      const queue = await call("GET", "/staff/queue");
      queueCount = queue.status === 200 ? queue.body.length : 0;
    }
    const box = document.getElementById("account");
    box.replaceChildren();
    if (!account) {
      box.append(h("button", { type: "button", class: "signin", onclick: openSignIn, "aria-label": "Sign in with Microsoft" }, msLogo(), h("span", {}, "Sign in", h("span", { class: "label-long" }, " with Microsoft"))));
    } else {
      box.append(
        h("span", { class: "who" }, h("strong", {}, account.gamertag),
          h("span", {}, account.role === "player" ? (session.game_online ? "In game now" : "Not in game") : account.role)),
        h("button", { type: "button", class: "quiet", onclick: signOut }, "Sign out"));
    }
  }

  function msLogo() {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "ms-logo");
    svg.setAttribute("aria-hidden", "true");
    [["0", "0", "#f25022"], ["8.5", "0", "#7fba00"], ["0", "8.5", "#00a4ef"], ["8.5", "8.5", "#ffb900"]].forEach(function (p) {
      const r = document.createElementNS(SVG, "rect");
      r.setAttribute("x", p[0]); r.setAttribute("y", p[1]); r.setAttribute("width", "7.5"); r.setAttribute("height", "7.5"); r.setAttribute("fill", p[2]);
      svg.append(r);
    });
    return svg;
  }

  /** Opens sign-in: the live site redirects to Microsoft; the preview offers sample accounts. */
  async function openSignIn() {
    if (backend.signIn) return backend.signIn();
    const dialog = document.getElementById("signin-dialog");
    const body = document.getElementById("signin-body");
    const personas = (await call("GET", "/auth/personas")).body;
    body.replaceChildren(
      h("p", { class: "field-hint" }, "Preview: pick a sample account to see each role. The live site sends you to Microsoft instead."),
      h("ul", { class: "personas" }, personas.map(function (p) {
        return h("li", {}, h("button", { type: "button", onclick: async function () {
          await call("POST", "/auth/preview", { xuid: p.xuid });
          dialog.close();
          await loadSession();
          toast("Signed in as " + p.gamertag + ".");
          render();
        } }, h("span", {}, p.gamertag), h("small", {}, p.blurb)));
      })));
    dialog.showModal();
  }

  async function signOut() {
    await call("POST", "/auth/signout");
    await loadSession();
    toast("Signed out.");
    if (M.parseRoute(location.hash).view !== "catalogue") location.hash = "";
    else render();
  }

  /** Queues a mod for the signed-in player's client; the game asks them to grant permissions. */
  async function sendToGame(mod, flap, button) {
    if (!session.account) return openSignIn();
    button.disabled = true;
    const result = await call("POST", "/mods/" + mod.slug + "/send");
    button.disabled = false;
    if (result.status !== 200) return toast(result.body.error);
    flap.textContent = result.body.game_online ? "Sent to your game" : "Waiting for your game";
    flap.classList.remove("sent");
    void flap.offsetWidth;
    flap.classList.add("sent");
    toast(mod.name + " is on its way. In Cinnabar, open Settings → Mods to review what it asks for and turn it on.");
  }

  function sendControls(mod) {
    const flap = h("span", { class: "flap" }, mod.update_pending ? "Update in review" : "");
    const queued = (session.library || []).some(function (entry) { return entry.slug === mod.slug; });
    if (queued) { flap.textContent = "In your game"; }
    const button = h("button", { type: "button", "aria-label": "Send " + mod.name + " to my game" }, icon("send"), "Send to game");
    button.addEventListener("click", function () { sendToGame(mod, flap, button); });
    return { flap: flap, button: button };
  }

  /** The catalogue: one band per rung, rows in fixed columns. */
  async function renderCatalogue(token, route) {
    const result = await call("GET", "/mods");
    if (token !== renderToken) return;
    if (result.status !== 200) return app.replaceChildren(failure(result.body.error));
    const mods = result.body;
    const params = new URLSearchParams((location.hash.split("?")[1]) || "");
    const rung = params.get("reach");
    const shown = M.filterMods(mods, search.value, rung);
    const counts = M.RUNGS.map(function (r, i) { return mods.filter(function (m) { return m.reach === i; }).length; });
    const rail = h("nav", { class: "rail", "aria-label": "Filter by reach" },
      h("h2", {}, "What mods can touch"),
      h("a", { class: "rung-link", href: "#/", "aria-current": rung == null ? "true" : false },
        h("span", {}), h("span", { class: "label" }, "All", h("span", { class: "label-long" }, " mods")), h("span", { class: "count" }, mods.length)),
      M.RUNGS.map(function (r, i) {
        return h("a", { class: "rung-link", href: "#/?reach=" + i, "aria-current": rung === String(i) ? "true" : false, "data-reach": i },
          reachGlyph(i), h("span", { class: "label" }, r.label), h("span", { class: "count" }, counts[i]),
          h("span", { class: "hint" }, r.summary));
      }),
      h("div", { class: "rail-actions" },
        h("a", { class: "button", href: "#/submit" }, icon("upload"), "Submit a mod"),
        session.account ? h("a", { class: "text", href: "#/mine" }, "Your mods") : null,
        M.atLeast(session.account, "moderator") ? h("a", { class: "text", href: "#/staff/queue" }, "Review queue (" + queueCount + ")") : null));
    const bands = M.RUNGS.map(function (r, i) {
      const rows = shown.filter(function (m) { return m.reach === i; });
      if (!rows.length) return null;
      return h("section", { class: "band", "data-reach": i, "aria-labelledby": "band-" + r.id },
        h("div", { class: "band-head" },
          h("h2", { id: "band-" + r.id }, reachGlyph(i, true), r.label),
          h("p", {}, r.summary),
          h("span", { class: "rule" }, ruleText(i))),
        h("ul", { class: "rows" }, rows.map(row)));
    }).filter(Boolean);
    const main = h("main", {},
      h("h1", {}, "Mods, sorted by what they can touch"),
      h("p", { class: "lede" }, "Every mod here was reviewed by Cinnabar staff. Mods run sandboxed and get no permissions until you allow them in game. The further down the list, the more of your game a mod can reach."),
      h("p", { class: "mobile-only" }, h("a", { href: "#/submit" }, "Submit a mod")),
      bands.length ? bands : h("p", { class: "empty" }, search.value ? "No mods match “" + search.value + "”. Try a permission name like HUD or Camera." : "Nothing on this rung yet."));
    app.replaceChildren(h("div", { class: "layout" }, rail, main));
  }

  function row(mod) {
    const send = sendControls(mod);
    return h("li", { class: "row", "data-reach": mod.reach },
      h("span", { class: "row-mark" }, modIcon(mod.slug, mod.reach), reachGlyph(mod.reach, true)),
      h("div", { class: "row-main" },
        h("div", { class: "row-title" }, h("a", { class: "name", href: "#/mod/" + mod.slug }, mod.name),
          h("span", { class: "by" }, "by " + mod.creator_name)),
        h("div", { class: "chips", "aria-label": "Permissions" }, mod.capabilities.length ? mod.capabilities.map(chip) : h("span", { class: "none" }, "No permissions")),
        h("p", { class: "summary" }, mod.summary)),
      h("span", { class: "version" }, mod.version),
      h("div", { class: "status-cell" }, send.button, send.flap));
  }

  /** The ladder on a mod page: every rung, the mod's highest one marked, its capabilities placed on their rungs. */
  function ladder(capabilities, reach) {
    return h("ol", { class: "ladder" }, M.RUNGS.map(function (r, i) {
      const here = capabilities.filter(function (name) { return M.capability(name).rung === i; });
      return h("li", { class: (i <= reach ? "within" : "") + (i === reach ? " top" : ""), "data-reach": i },
        reachGlyph(i),
        h("span", { class: "rname" }, r.label, h("small", {}, r.summary)),
        h("div", { class: "caps-cell" }, here.length
          ? h("ul", { class: "caps" }, here.map(function (name) {
            const cap = M.capability(name);
            return h("li", {}, h("span", { class: "cap-name" }, cap.label), h("span", { class: "cap-desc" }, cap.description),
              cap.sensitive ? h("span", { class: "tag" }, "sensitive") : null);
          }))
          : h("span", { class: "none" }, i > reach ? "Can't reach this" : "Nothing requested here")));
    }));
  }

  async function renderMod(token, route) {
    const result = await call("GET", "/mods/" + encodeURIComponent(route.slug));
    if (token !== renderToken) return;
    if (result.status !== 200) return app.replaceChildren(h("main", { class: "layout" }, h("div", {}), failure(result.body.error)));
    const mod = result.body;
    const send = sendControls(mod);
    const report = h("button", { type: "button", class: "neutral", onclick: function () { openReport(mod); } }, icon("flag"), "Report");
    app.replaceChildren(h("main", { class: "layout single" },
      h("div", {},
        h("a", { class: "crumb", href: "#/" }, icon("back"), "All mods"),
        h("div", { class: "mod-head" }, modIcon(mod.slug, mod.reach),
          h("div", {}, h("h1", {}, mod.name), h("p", {}, "by " + mod.creator_name + " · ", h("span", { class: "mono" }, mod.version))),
          h("div", { class: "mod-actions" }, h("div", { class: "status-cell" }, send.button, send.flap), report)),
        h("div", { class: "mod-body" },
          h("div", { class: "stack" },
            h("section", { "aria-labelledby": "touch" },
              h("h2", { id: "touch" }, "What it can touch"),
              ladder(mod.capabilities, mod.reach),
              h("p", { class: "grant-note" }, "These are requests. Cinnabar grants none of them until you allow each one in Settings → Mods, and you can revoke them at any time.")),
            h("section", { "aria-labelledby": "about" }, h("h2", { id: "about" }, "About"),
              h("p", { class: "prose" }, mod.summary), h("p", { class: "prose" }, mod.description))),
          h("aside", { class: "stack" },
            h("section", { class: "panel", "aria-labelledby": "review" }, h("h2", { id: "review" }, "Review"),
              h("dl", { class: "facts" },
                h("dt", {}, "Reviewed by"), h("dd", {}, mod.reviewed_by),
                h("dt", {}, "Approved"), h("dd", {}, ago(mod.updated_at)),
                h("dt", {}, "Rule"), h("dd", {}, ruleText(mod.reach)),
                h("dt", {}, "SHA-256"), h("dd", {}, h("code", {}, mod.sha256)),
                h("dt", {}, "Size"), h("dd", {}, Math.round(mod.bytes / 1024) + " KB"),
                h("dt", {}, "Source"), h("dd", {}, mod.source ? h("a", { href: mod.source, rel: "noopener" }, mod.source.replace("https://github.com/", "")) : "Not published"))),
            h("section", { class: "panel", "aria-labelledby": "versions" }, h("h2", { id: "versions" }, "Versions"),
              h("ul", { class: "history" }, mod.history.map(function (v) {
                return h("li", {}, h("span", { class: "mono" }, v.version), v.pulled ? h("span", { class: "pill pulled" }, "pulled") : h("span", { class: "field-hint" }, ago(v.at)));
              }))))))));
    document.title = mod.name + " · Cinnabar mods";
  }

  function openReport(mod) {
    if (!session.account) return openSignIn();
    const dialog = document.getElementById("report-dialog");
    const form = document.getElementById("report-form");
    const error = document.getElementById("report-error");
    form.reset();
    error.textContent = "";
    form.onsubmit = async function (event) {
      event.preventDefault();
      const data = new FormData(form);
      const result = await call("POST", "/mods/" + mod.slug + "/reports", { reason: data.get("reason"), details: data.get("details") });
      if (result.status !== 200) { error.textContent = result.body.error; return; }
      dialog.close();
      toast("Thanks. Staff will look at your report on " + mod.name + ".");
    };
    dialog.showModal();
  }

  /** Builds a tiny component carrying only metadata and grant sections, for trying the form without a real mod. */
  function sampleComponent() {
    const enc = new TextEncoder();
    const section = function (name, data) {
      const n = enc.encode(name);
      const body = [n.length].concat(Array.from(n), Array.from(data));
      return [0, body.length].concat(body);
    };
    const bytes = [0, 0x61, 0x73, 0x6d, 0x0d, 0, 1, 0]
      .concat(section("version", enc.encode("0.1.0")))
      .concat(section("description", enc.encode("Shows a compass strip at the top of the screen.")))
      .concat(section("cinnabar:grants", enc.encode(JSON.stringify({ hud: true, player_state: true }))));
    return new File([new Uint8Array(bytes)], "compass-strip.wasm", { type: "application/wasm" });
  }

  async function renderSubmit(token) {
    if (!session.account) {
      return app.replaceChildren(h("main", { class: "layout single" }, h("div", {},
        h("h1", {}, "Submit a mod"),
        h("p", { class: "lede" }, "Sign in with the Microsoft account you play with. Your gamertag is shown as the creator, and staff review every version before it's public."),
        h("p", {}, h("button", { type: "button", class: "signin", onclick: openSignIn }, msLogo(), "Sign in with Microsoft")))));
    }
    let file = null;
    let parsed = null;
    const errors = {};
    const input = h("input", { type: "file", accept: ".wasm,application/wasm", id: "component" });
    const dropText = h("span", {}, h("strong", {}, "Choose your mod's .wasm component"), h("br"), h("span", { class: "field-hint" }, "or drop it here. It's read in your browser first, nothing is sent until you submit."));
    const drop = h("label", { class: "drop" }, icon("upload"), dropText, input);
    const detected = h("div", { "aria-live": "polite" });
    const fields = {};
    const field = function (name, label, hint, el) {
      fields[name] = el;
      const err = h("span", { class: "error", id: name + "-error" });
      el.setAttribute("aria-describedby", name + "-error");
      errors[name] = err;
      return h("label", {}, label, hint ? h("span", { class: "field-hint" }, hint) : null, el, err);
    };
    const preview = h("aside", { class: "panel stack" }, h("h2", {}, "Review it will need"), h("p", { class: "field-hint" }, "Choose a file to see which rung it lands on."));

    async function take(next) {
      file = next;
      try {
        parsed = M.readComponent(await file.arrayBuffer());
        const reach = M.reachOf(parsed.grants);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())))
          .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
        parsed.sha256 = digest;
        parsed.reach = reach;
        if (parsed.version && !fields.version.value) fields.version.value = parsed.version;
        if (parsed.name && !fields.name.value) fields.name.value = parsed.name;
        if (!fields.name.value) fields.name.value = file.name.replace(/\.wasm$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        if (!fields.slug.value) fields.slug.value = file.name.replace(/\.wasm$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (parsed.description && !fields.summary.value) fields.summary.value = parsed.description.slice(0, 140);
        const caps = M.requestedCapabilities(parsed.grants);
        detected.replaceChildren(h("div", { class: "detected" }, reachGlyph(reach, true), h("div", {},
          h("strong", {}, file.name), h("span", { class: "field-hint" }, " · " + Math.round(file.size / 1024 * 10) / 10 + " KB"),
          h("div", { class: "chips", style: "margin-top: 8px" }, caps.length ? caps.map(chip) : h("span", { class: "none" }, parsed.grantsDeclared ? "Requests no permissions" : "No cinnabar:grants section, so it requests nothing")),
          h("p", { class: "field-hint mono" }, "sha256 " + digest))));
        preview.replaceChildren(h("h2", {}, "Review it will need"), ladder(caps, reach),
          h("p", { class: "grant-note" }, ruleText(reach) + ". " + (reach >= 3 ? "Link your source: staff compare it with the file." : "Most reviews finish within a day.")));
      } catch (error) {
        parsed = null;
        detected.replaceChildren(h("p", { class: "error", role: "alert" }, error.message));
      }
    }
    input.addEventListener("change", function () { if (input.files[0]) take(input.files[0]); });
    drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
    drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); });
    const formError = h("p", { class: "error", role: "alert" });
    const form = h("form", { novalidate: true },
      drop, detected,
      h("div", { class: "grid-2" },
        field("name", "Name", null, h("input", { type: "text", maxlength: 64, required: true })),
        field("slug", "Address", location.host + "/mods/#/mod/…", h("input", { type: "text", maxlength: 40, required: true, spellcheck: "false" }))),
      field("summary", "One-line summary", "Shown in the list. Say what it does, not how good it is.", h("input", { type: "text", maxlength: 140, required: true })),
      field("description", "Description", null, h("textarea", { maxlength: 2000 })),
      h("div", { class: "grid-2" },
        field("version", "Version", "SemVer, like 1.0.0", h("input", { type: "text", required: true, spellcheck: "false" })),
        field("source", "Source repository", "Required for Acts and Network mods", h("input", { type: "url", placeholder: "https://github.com/you/mod" }))),
      formError,
      h("div", { class: "decision" }, h("button", { type: "submit" }, "Submit for review"),
        h("button", { type: "button", class: "quiet", onclick: function () { take(sampleComponent()); } }, "No file handy? Use a sample")));
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      Object.values(errors).forEach(function (el) { el.textContent = ""; });
      Object.values(fields).forEach(function (el) { el.removeAttribute("aria-invalid"); });
      if (!parsed) { formError.textContent = "Choose your mod's .wasm file first."; return; }
      const listing = {};
      Object.keys(fields).forEach(function (k) { listing[k] = fields[k].value.trim(); });
      const body = Object.assign({ grants: parsed.grants || {}, sha256: parsed.sha256, bytes: file.size }, listing);
      let result;
      try {
        result = backend.submit ? await backend.submit(listing, file) : await call("POST", "/submissions", body);
      } catch (error) {
        result = { status: 0, body: { error: "Can't reach the marketplace. Check your connection and try again." } };
      }
      if (result.status === 200) { toast(body.name + " " + body.version + " is in the review queue."); location.hash = "#/mine"; return; }
      formError.textContent = result.body.error;
      Object.entries(result.body.fields || {}).forEach(function ([k, message]) {
        if (errors[k]) { errors[k].textContent = message; fields[k].setAttribute("aria-invalid", "true"); }
      });
      const first = Object.keys(result.body.fields || {})[0];
      if (first && fields[first]) fields[first].focus();
    });
    app.replaceChildren(h("main", { class: "layout single" }, h("div", {},
      h("a", { class: "crumb", href: "#/" }, icon("back"), "All mods"),
      h("h1", {}, "Submit a mod"),
      h("p", { class: "lede" }, "Publishing as " + session.account.gamertag + ". Staff check that the file does what the listing says and asks only for what it needs."),
      h("div", { class: "submit-layout" }, form, preview))));
  }

  function statusPill(v) {
    if (v.pulled) return h("span", { class: "pill pulled" }, "Pulled");
    const labels = { submitted: "In review " + v.approvals.length + "/" + v.rule.count, approved: "Approved", changes: "Changes requested", rejected: "Rejected" };
    return h("span", { class: "pill " + v.status }, labels[v.status]);
  }

  async function renderMine(token) {
    if (!session.account) { openSignIn(); location.hash = "#/"; return; }
    const result = await call("GET", "/me/mods");
    if (token !== renderToken) return;
    const versions = result.status === 200 ? result.body : [];
    app.replaceChildren(h("main", { class: "layout single" }, h("div", {},
      h("a", { class: "crumb", href: "#/" }, icon("back"), "All mods"),
      h("h1", {}, "Your mods"),
      h("p", { class: "lede" }, "Every version you've submitted and where it is in review."),
      versions.length ? h("table", { style: "margin-top: 24px" },
        h("thead", {}, h("tr", {}, h("th", {}, "Mod"), h("th", {}, "Version"), h("th", {}, "Reach"), h("th", {}, "Status"), h("th", { class: "hide-narrow" }, "Submitted"), h("th", {}, "Staff note"))),
        h("tbody", {}, versions.map(function (v) {
          return h("tr", {}, h("td", {}, v.status === "approved" && !v.pulled ? h("a", { href: "#/mod/" + v.slug }, v.name) : v.name),
            h("td", { class: "mono" }, v.version), h("td", {}, reachGlyph(v.reach), " " + M.RUNGS[v.reach].label),
            h("td", {}, statusPill(v)), h("td", { class: "hide-narrow" }, ago(v.submitted_at)), h("td", {}, v.note || ""));
        })))
        : h("p", { class: "empty" }, "You haven't submitted anything yet. ", h("a", { href: "#/submit" }, "Submit your first mod.")))));
  }

  /** Staff console: queue with review pane, reports, people and roles, and the audit log. */
  async function renderStaff(token, route) {
    if (!M.atLeast(session.account, "moderator")) {
      return app.replaceChildren(h("main", { class: "layout single" }, h("div", {},
        h("h1", {}, "Staff"), h("p", { class: "lede" }, session.account ? "This area is for Cinnabar moderators and admins." : "Sign in with your Microsoft account to continue."),
        session.account ? null : h("p", {}, h("button", { type: "button", class: "signin", onclick: openSignIn }, msLogo(), "Sign in with Microsoft")))));
    }
    const reports = await call("GET", "/staff/reports");
    const open = reports.status === 200 ? reports.body.filter(function (r) { return r.status === "open"; }).length : 0;
    const tabs = h("nav", { class: "tabs", "aria-label": "Staff" }, [["queue", "Review queue", queueCount], ["reports", "Reports", open], ["people", "People"], ["audit", "Audit log"]].map(function (t) {
      return h("a", { href: "#/staff/" + t[0], "aria-current": route.tab === t[0] ? "page" : false }, t[1], t[2] != null ? h("span", { class: "count" }, t[2]) : null);
    }));
    const body = h("div", {});
    const views = { queue: staffQueue, reports: staffReports, people: staffPeople, audit: staffAudit };
    await views[route.tab](body, route, reports.body);
    if (token !== renderToken) return;
    app.replaceChildren(h("main", { class: "layout single" }, h("div", {},
      h("h1", {}, "Staff"),
      h("p", { class: "lede" }, "Signed in as " + session.account.gamertag + ", " + session.account.role + ". Every action here is recorded in the audit log."),
      tabs, body)));
  }

  async function staffQueue(body, route) {
    const queue = (await call("GET", "/staff/queue")).body || [];
    const selected = route.id || (queue[0] && queue[0].id);
    const pane = h("div", { class: "review panel" });
    if (selected) await reviewPane(pane, selected);
    else pane.replaceChildren(h("p", { class: "empty" }, "The queue is empty. Nice work."));
    body.replaceChildren(h("div", { class: "console" },
      queue.length ? h("table", {},
        h("caption", { class: "visually-hidden" }, "Versions waiting for review, highest reach first"),
        h("thead", {}, h("tr", {}, h("th", {}, "Mod"), h("th", {}, "Reach"), h("th", { class: "hide-narrow" }, "Creator"), h("th", { class: "num" }, "Waiting"), h("th", { class: "num" }, "Approvals"))),
        h("tbody", {}, queue.map(function (v) {
          return h("tr", { class: "pick", "aria-selected": v.id === selected ? "true" : "false", onclick: function () { location.hash = "#/staff/queue/" + v.id; } },
            h("td", {}, h("a", { href: "#/staff/queue/" + v.id }, v.name), " ", h("span", { class: "mono field-hint" }, v.version),
              v.previous ? h("div", { class: "field-hint" }, "Update from " + v.previous.version) : h("div", { class: "field-hint" }, "New mod")),
            h("td", { "data-reach": v.reach }, reachGlyph(v.reach), " " + M.RUNGS[v.reach].label),
            h("td", { class: "hide-narrow" }, v.creator_name),
            h("td", { class: "num" }, waited(v.submitted_at)),
            h("td", { class: "num" }, v.approvals.length + "/" + v.rule.count + (v.rule.admin ? " · admin" : "")));
        })))
        : h("p", { class: "empty" }, "No versions are waiting."),
      pane));
  }

  async function reviewPane(pane, id) {
    const result = await call("GET", "/staff/versions/" + id);
    if (result.status !== 200) return pane.replaceChildren(failure(result.body.error));
    const v = result.body;
    const note = h("textarea", { id: "review-note", placeholder: "Required when rejecting or asking for changes. The creator sees this." });
    const why = h("p", { class: "why", role: "status" });
    const decide = async function (decision) {
      const res = await call("POST", "/staff/versions/" + v.id + "/decision", { decision: decision, note: note.value });
      if (res.status !== 200) { why.textContent = res.body.error; return; }
      toast(v.name + " " + v.version + ": " + (res.body.status === "approved" ? "approved and published." : res.body.status === "submitted" ? "your approval is recorded; it needs one more." : res.body.status === "changes" ? "sent back with your note." : "rejected."));
      await loadSession();
      location.hash = "#/staff/queue";
      render();
    };
    const approve = M.can(session.account, "approve", { version: v });
    const review = M.can(session.account, "review", { version: v });
    const diff = v.previous ? v.previous.diff : null;
    pane.replaceChildren(
      h("div", {}, h("h2", {}, v.name, " ", h("span", { class: "mono field-hint" }, v.version)),
        h("p", { class: "field-hint" }, "by " + v.creator_name + " · submitted " + ago(v.submitted_at))),
      h("div", {}, h("div", { class: "label" }, "Asks for"),
        h("ul", { class: "caps", style: "margin-top: 6px" }, v.capabilities.length ? v.capabilities.map(function (name) {
          const cap = M.capability(name);
          const added = diff && diff.added.includes(name);
          return h("li", { "data-reach": cap.rung }, h("span", { class: "dot", "aria-hidden": "true" }), h("span", { class: "cap-name" + (added ? " diff-add" : "") }, cap.label),
            added ? h("span", { class: "tag new" }, "new in " + v.version) : null,
            h("span", { class: "cap-desc" }, cap.description), cap.sensitive ? h("span", { class: "tag" }, "sensitive") : null);
        }) : h("li", { class: "none" }, "Nothing")),
        diff && diff.removed.length ? h("p", { class: "field-hint" }, "Dropped since " + v.previous.version + ": ", diff.removed.map(function (n) { return h("span", { class: "diff-del mono" }, M.capability(n).label + " "); })) : null,
        diff && !diff.added.length ? h("p", { class: "field-hint" }, "No new permissions since " + v.previous.version + ".") : null),
      h("dl", { class: "facts" },
        h("dt", {}, "Rule"), h("dd", {}, ruleText(v.reach)),
        h("dt", {}, "Approvals"), h("dd", { class: "approvals" }, v.approvals.length ? v.approvals.map(function (a) { return a.gamertag + (a.admin ? " (admin)" : ""); }).join(", ") : "None yet"),
        h("dt", {}, "SHA-256"), h("dd", {}, h("code", {}, v.sha256)),
        h("dt", {}, "Size"), h("dd", {}, Math.round(v.bytes / 1024) + " KB"),
        h("dt", {}, "Source"), h("dd", {}, v.source ? h("a", { href: v.source, rel: "noopener" }, v.source.replace("https://github.com/", "")) : "Not linked")),
      h("div", {}, h("div", { class: "label" }, "Check before approving"),
        h("ul", { class: "checklist" },
          h("li", {}, "The mod does what its summary says, and nothing else."),
          h("li", {}, "Each permission is needed for a feature the listing describes."),
          h("li", {}, "It gives no unfair advantage on servers: no x-ray, aim help, reach or auto-clicking."),
          v.reach >= 3 ? h("li", {}, "The linked source builds to this exact SHA-256.") : null)),
      h("label", { for: "review-note" }, "Note to the creator", note),
      h("div", { class: "decision" },
        h("button", { type: "button", disabled: !approve.ok, onclick: function () { decide("approve"); } }, icon("check"), "Approve"),
        h("button", { type: "button", class: "neutral", disabled: !review.ok, onclick: function () { decide("changes"); } }, "Ask for changes"),
        h("button", { type: "button", class: "neutral", disabled: !review.ok, onclick: function () { decide("reject"); } }, "Reject")),
      !approve.ok ? h("p", { class: "why" }, approve.reason) : null,
      why);
  }

  async function staffReports(body, route, reports) {
    const canPull = M.can(session.account, "pull").ok;
    body.replaceChildren(h("div", { style: "margin-top: 20px; display: grid; gap: 16px; max-width: 820px" }, (reports || []).length ? reports.map(function (r) {
      const note = h("textarea", { placeholder: "What you found. Kept in the audit log." });
      const why = h("p", { class: "why", role: "status" });
      const reasons = { broken: "Doesn't work", advantage: "Unfair advantage", malicious: "Does something it doesn't say", stolen: "Someone else's work", other: "Other" };
      return h("article", { class: "panel stack", style: "gap: 12px" },
        h("div", { style: "display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline" },
          h("h2", { style: "margin: 0" }, h("a", { href: "#/mod/" + r.slug }, r.name), " ", h("span", { class: "mono field-hint" }, r.version)),
          h("span", { class: "pill " + (r.status === "open" ? "submitted" : "approved") }, r.status === "open" ? "Open" : "Resolved"),
          r.pulled ? h("span", { class: "pill pulled" }, "Pulled") : null,
          h("span", { class: "field-hint" }, reasons[r.reason] + " · from " + r.reporter_name + " · " + ago(r.at))),
        h("p", { class: "prose", style: "margin: 0" }, "“" + r.details + "”"),
        r.status === "resolved" ? h("p", { class: "field-hint", style: "margin: 0" }, r.resolved_by_name + ": " + r.resolution) : h("div", { class: "stack", style: "gap: 10px" },
          note,
          h("div", { class: "decision" },
            h("button", { type: "button", class: "neutral", onclick: async function () {
              const res = await call("POST", "/staff/reports/" + r.id + "/resolve", { note: note.value });
              if (res.status !== 200) { why.textContent = res.body.error; return; }
              toast("Report resolved."); render();
            } }, "Resolve"),
            h("button", { type: "button", disabled: !canPull || r.pulled, onclick: async function () {
              const res = await call("POST", "/staff/versions/" + r.version_id + "/pull", { reason: note.value });
              if (res.status !== 200) { why.textContent = res.body.error; return; }
              toast(r.name + " " + r.version + " was pulled. Players who have it get it turned off with your reason."); render();
            } }, "Pull this version")),
          canPull ? null : h("p", { class: "why" }, "Only admins can pull a published version."),
          why));
    }) : h("p", { class: "empty" }, "No reports.")));
  }

  async function staffPeople(body) {
    const people = (await call("GET", "/staff/people")).body || [];
    const gamertag = h("input", { type: "text", id: "role-gamertag", required: true, autocomplete: "off" });
    const role = h("select", { id: "role-select" }, ["player", "moderator", "admin"].map(function (r) { return h("option", { value: r }, r === "player" ? "No staff role" : r[0].toUpperCase() + r.slice(1)); }));
    const reason = h("input", { type: "text", id: "role-reason", required: true });
    const why = h("p", { class: "why", role: "status" });
    const allowed = M.atLeast(session.account, "admin");
    const form = h("form", { class: "panel", novalidate: true },
      h("h2", {}, "Change a role"),
      h("p", { class: "field-hint", style: "margin: 0" }, "Roles follow the player's Xbox account. They must have signed in once. Admins add moderators; only the owner adds admins."),
      h("label", { for: "role-gamertag" }, "Gamertag", gamertag),
      h("label", { for: "role-select" }, "Role", role),
      h("label", { for: "role-reason" }, "Reason", h("span", { class: "field-hint" }, "Kept in the audit log."), reason),
      h("div", { class: "decision" }, h("button", { type: "submit", disabled: !allowed }, "Save role")),
      allowed ? null : h("p", { class: "why" }, "Only admins manage staff."),
      why);
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const res = await call("POST", "/staff/people/role", { gamertag: gamertag.value, role: role.value, reason: reason.value });
      if (res.status !== 200) { why.textContent = res.body.error; return; }
      toast(res.body.gamertag + " is now " + (res.body.role === "player" ? "a player" : "a " + res.body.role) + ".");
      await loadSession(); render();
    });
    body.replaceChildren(h("div", { class: "console" },
      h("table", {}, h("caption", { class: "visually-hidden" }, "Staff accounts"),
        h("thead", {}, h("tr", {}, h("th", {}, "Gamertag"), h("th", {}, "Role"), h("th", { class: "hide-narrow" }, "XUID"))),
        h("tbody", {}, people.map(function (p) {
          return h("tr", {}, h("td", {}, p.gamertag), h("td", {}, h("span", { class: "pill" }, p.role)), h("td", { class: "mono hide-narrow" }, p.xuid));
        }))),
      form));
  }

  async function staffAudit(body) {
    const entries = (await call("GET", "/staff/audit")).body || [];
    body.replaceChildren(h("table", { style: "margin-top: 20px" },
      h("caption", { class: "visually-hidden" }, "Staff actions, newest first"),
      h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Who"), h("th", {}, "Action"), h("th", {}, "Target"), h("th", { class: "hide-narrow" }, "Note"))),
      h("tbody", {}, entries.map(function (e) {
        return h("tr", {}, h("td", { class: "field-hint" }, ago(e.at)), h("td", {}, e.actor_name), h("td", {}, e.action), h("td", { class: "mono" }, e.target), h("td", { class: "hide-narrow" }, e.note));
      }))));
  }

  function failure(message) {
    return h("div", { class: "empty", role: "alert" }, h("p", {}, message || "Something went wrong."), h("button", { type: "button", class: "neutral", onclick: render }, "Try again"));
  }

  /** Draws the view named by the location hash. */
  async function render() {
    const token = ++renderToken;
    const route = M.parseRoute(location.hash);
    document.title = route.view === "staff" ? "Staff · Cinnabar mods" : "Mods · Cinnabar";
    if (!app.firstChild) app.replaceChildren(h("div", { class: "layout" }, h("div", {}), h("div", { class: "skeleton" })));
    const views = { catalogue: renderCatalogue, mod: renderMod, submit: renderSubmit, mine: renderMine, staff: renderStaff };
    await views[route.view](token, route);
    if (route.view !== "catalogue" && route.view !== "staff") window.scrollTo(0, 0);
  }

  document.querySelectorAll("dialog [data-close]").forEach(function (button) {
    button.addEventListener("click", function () { button.closest("dialog").close(); });
  });
  document.querySelectorAll("dialog").forEach(function (dialog) {
    dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
  });
  search.addEventListener("input", function () {
    if (M.parseRoute(location.hash).view !== "catalogue") location.hash = "#/";
    else render();
  });
  window.addEventListener("hashchange", render);
  if (backend.backend === "mock") {
    document.getElementById("preview-note").hidden = false;
    document.getElementById("reset-preview").addEventListener("click", async function () {
      backend.reset();
      await loadSession();
      toast("Sample data restored.");
      render();
    });
  }
  const SIGN_IN_ERRORS = {
    cancelled: "Sign-in was cancelled.",
    no_xbox_profile: "That Microsoft account has no Xbox profile yet. Sign in to Minecraft once, then try again.",
    child_account: "A parent needs to allow this account to use Xbox Live in Microsoft family settings.",
    xbox_unavailable: "Xbox sign-in isn't answering. Try again in a minute.",
    failed: "Sign-in didn't finish. Try again.",
  };
  const signInError = new URLSearchParams(location.search).get("signin_error");
  if (signInError) {
    toast(SIGN_IN_ERRORS[signInError] || SIGN_IN_ERRORS.failed);
    history.replaceState(null, "", location.pathname + location.hash);
  }
  loadSession().then(render);
})();
