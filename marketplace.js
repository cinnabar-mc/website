(function () {
  'use strict';
  const M = window.CinnabarMarket;
  const C = window.CinnabarContent;
  const config = (window.CINNABAR_DOWNLOADS || {}).marketplace || { backend: 'mock' };
  const app = document.getElementById('app');
  const feedback = document.getElementById('feedback');
  const backend = config.backend === 'http' && config.api_url
    ? window.CinnabarMarketHttp.createHttpApi(config.api_url.replace(/\/$/, ''), window.fetch.bind(window), window.location)
    : window.CinnabarMarketMock.createMockApi(safeStorage());
  let session = { account: null, library: [] };
  let generation = 0;
  let query = '';
  let selectedCategory = 'all';
  let limited = false;
  let order = 'recommended';
  let draft = null;
  let draftOwner = null;
  let step = 'project';
  let fileToken = 0;
  let validationPending = false;
  let validationController = null;
  let mediaPending = false;
  const steps = ['project', 'media', 'release', 'checks'];
  const categories = ['Interface', 'Visuals', 'Camera', 'Utilities', 'Gameplay', 'Network'];
  const paths = {
    hud: '<rect x="4" y="5" width="24" height="22"/><path d="M4 12h24M10 12v15m5-10h8m-8 5h5"/>',
    sun: '<path d="M3 23h26M8 23a8 8 0 0 1 16 0M16 3v5M4 10l4 4m20-4-4 4M2 18h5m18 0h5M11 28h10"/>',
    zoom: '<path d="M10 4H4v6m18-6h6v6M4 22v6h6m18-6v6h-6"/><circle cx="15" cy="15" r="6"/><path d="m19 19 5 5"/>',
    grid: '<rect x="4" y="4" width="24" height="24"/><path d="M12 4v24m8-24v24M4 12h24M4 20h24"/>',
    shield: '<path d="m16 3 10 4v8c0 7-10 13-10 13S6 22 6 15V7zM11 15l4 4 7-8"/>',
    arrow: '<path d="M5 16h22m-8-8 8 8-8 8"/>',
    search: '<circle cx="14" cy="14" r="8"/><path d="m20 20 8 8"/>',
    upload: '<path d="M16 23V4m-7 7 7-7 7 7M5 23v6h22v-6"/>',
  };

  /** Degrade to session-only storage when browser storage is disabled. */
  function safeStorage() {
    try { const storage = window.localStorage; storage.getItem('cinnabar'); return storage; }
    catch (_) { return { getItem: () => null, setItem: () => { throw new Error('Storage unavailable.'); }, removeItem: () => {} }; }
  }

  /** Build DOM with text nodes; only the fixed icon vocabulary below uses markup. */
  function h(tag, attrs, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
      else if (['value', 'checked', 'disabled', 'hidden'].includes(key)) element[key] = value;
      else element.setAttribute(key, value === true ? '' : String(value));
    }
    children.flat(Infinity).forEach(child => {
      if (child !== null && child !== undefined && child !== false) element.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return element;
  }

  /** Draw authored geometry, never creator-supplied SVG. */
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = paths[name] || paths.hud;
    return svg;
  }

  /** Pick an icon from actual listing categories rather than invent an uploaded image. */
  function modIcon(mod) {
    const category = C.category(mod);
    return h('div', { class: 'mod-icon ' + (category === 'Visuals' ? 'warm' : category === 'Camera' ? 'blue' : '') },
      icon(category === 'Visuals' ? 'sun' : category === 'Camera' ? 'zoom' : category === 'Utilities' ? 'grid' : 'hud'));
  }

  /** Create an explicit non-submitting action with a stable focus identity. */
  function button(label, action, className = 'btn quiet', key = '') {
    return h('button', { type: 'button', class: className, 'data-focus-key': key, onclick: action }, label);
  }

  /** Announce action outcomes through one persistent live region. */
  function announce(message, error = false) {
    feedback.textContent = message; feedback.classList.toggle('error', error);
  }

  /** Keep transport failures distinct from empty successful responses. */
  async function call(method, path, body) {
    try { return await backend.request(method, path, body); }
    catch (_) { return { status: 0, body: { error: 'Cannot reach the marketplace. Check your connection and retry.' } }; }
  }

  /** Recover focus when a mutation replaces the currently focused subtree. */
  function mount(token, node, focusKey) {
    if (token !== generation) return;
    const previous = document.activeElement;
    const key = focusKey || previous?.getAttribute('data-focus-key');
    const hadFocus = app.contains(previous);
    app.replaceChildren(node);
    const target = key && [...app.querySelectorAll('[data-focus-key]')].find(el => el.getAttribute('data-focus-key') === key && !el.disabled);
    if (target) target.focus();
    else if (hadFocus) app.focus();
  }

  /** Build a recoverable failure without treating the last cached catalogue as live. */
  function failure(message) {
    return h('section', { class: 'empty', role: 'alert' }, h('h2', {}, 'The marketplace could not load.'),
      h('p', {}, message || 'Please retry.'), button('Try again', render, 'btn primary', 'retry'));
  }

  /** Reflect server identity; preview account choices never appear in HTTP mode. */
  async function loadSession() {
    const response = await call('GET', '/me');
    if (response.status !== 200) { session = { account: null, library: [] }; return response; }
    session = response.body;
    session.library = Array.isArray(session.library) ? session.library : [];
    return response;
  }

  /** Keep the shared site header and marketplace account/navigation consistent. */
  function chrome(route) {
    const box = document.getElementById('account');
    const account = session.account;
    box.replaceChildren(account ? h('div', { class: 'row' }, h('span', { class: 'who small' }, account.gamertag,
      h('small', {}, backend.backend === 'mock' ? 'Preview account · ' + account.role : account.role)),
    button(backend.backend === 'mock' ? 'Switch account' : 'Sign out', backend.backend === 'mock' ? signIn : signOut, 'btn quiet', 'account'))
      : button(backend.backend === 'mock' ? 'Try a preview account' : 'Sign in with Microsoft', signIn, 'btn', 'account'));
    const links = [['catalogue', '#/', 'Explore mods'], ['library', '#/library', 'My library (' + session.library.length + ')']];
    if (account) links.push(['mine', '#/mine', 'Your projects']);
    if (M.atLeast(account, 'moderator')) links.push(['staff', '#/staff/queue', 'Review workspace']);
    links.push(['submit', '#/submit', 'Publish a mod']);
    document.getElementById('navigation').replaceChildren(...links.map(([view, href, label]) => h('a', {
      href, 'aria-current': route.view === view ? 'page' : null, class: view === 'submit' ? 'publish-link' : '',
      'data-focus-key': 'nav:' + view,
    }, label)));
  }

  /** Use Microsoft's real redirect only through the configured HTTP adapter. */
  async function signIn() {
    if (backend.signIn) { backend.signIn(); return; }
    const response = await call('GET', '/auth/personas');
    if (response.status !== 200) { announce(response.body.error, true); return; }
    const dialog = document.getElementById('signin-dialog');
    document.getElementById('signin-body').replaceChildren(...response.body.map(persona =>
      button(h('span', {}, persona.gamertag, h('small', {}, persona.blurb)), async () => {
        const signed = await call('POST', '/auth/preview', { xuid: persona.xuid });
        if (signed.status !== 200) { announce(signed.body.error, true); return; }
        validationController?.abort(); validationPending = false; mediaPending = false;
        fileToken++; draft = null; draftOwner = null; step = 'project';
        dialog.close(); await loadSession(); await render();
        announce('Using the ' + persona.gamertag + ' preview account.');
      }, 'btn quiet')));
    dialog.showModal();
  }

  /** End the session and discard in-memory artifacts on account changes. */
  async function signOut() {
    const result = await call('POST', '/auth/signout');
    if (result.status !== 200) return announce(result.body.error, true);
    validationController?.abort(); validationPending = false; mediaPending = false;
    fileToken++; draft = null; draftOwner = null;
    await loadSession(); location.hash = '#/'; await render(); announce('Signed out.');
  }

  /** Show actual permissions with their client-owned descriptions. */
  function permissions(mod, grants) {
    return h('ul', { class: 'perm-list' }, (mod.capabilities || []).length ? mod.capabilities.map(name => {
      const cap = M.capability(name);
      return h('li', {}, h('span', { class: 'checkline' }, icon('shield'), cap ? cap.label : name),
        cap ? h('span', { class: 'muted' }, cap.description) : null,
        name === 'commands' && grants?.commands ? h('p', { class: 'permission-value' }, grants.commands.join(', ')) : null);
    }) : h('li', { class: 'muted' }, 'No optional permissions declared.'));
  }

  /** Add to the account library without claiming an installation or runtime grant. */
  async function addToLibrary(mod, control) {
    if (!session.account) return signIn();
    control.disabled = true;
    const owner = session.account.xuid;
    const result = await call('POST', '/mods/' + encodeURIComponent(mod.slug) + '/send');
    control.disabled = false;
    if (owner !== session.account?.xuid) return;
    if (result.status !== 200) return announce(result.body.error, true);
    await loadSession(); chrome(M.parseRoute(location.hash));
    control.textContent = 'In your library';
    announce(backend.backend === 'mock' ? mod.name + ' added to your preview library. Nothing is installed.'
      : mod.name + (result.body.game_online ? ' queued for your game.' : ' queued until your game connects.') + ' Review permissions in Cinnabar before enabling it.');
  }

  /** Preserve unavailable library selections so they remain visible and removable. */
  async function removeFromLibrary(slug) {
    const result = await call('POST', '/mods/' + encodeURIComponent(slug) + '/remove');
    if (result.status !== 200) return announce(result.body.error, true);
    await loadSession(); await render(); announce('Removed from your preview library.');
  }

  /** Present a clearly illustrative UI preview without fictional download counts. */
  function hudPreview() {
    return h('div', { class: 'hud-preview' }, h('span', { class: 'preview-caption' }, 'Illustrative mod interface'),
      h('div', { class: 'hud-widget' }, h('div', { class: 'direction' }, h('span', {}, 'PLAINS'), h('span', {}, 'N')),
        h('div', { class: 'coord' }, '128 / 64 / −256'), h('div', { class: 'meters' }, Array.from({ length: 10 }, () => h('i'))),
        h('div', { class: 'divider' }, 'Compact HUD layout')),
      h('span', { class: 'preview-footnote small' }, 'Sample interface · no game capture'));
  }

  /** Render category browsing and the saved library with search state retained. */
  async function catalogue(token, libraryOnly) {
    const response = await call('GET', '/mods');
    if (token !== generation) return;
    if (response.status !== 200) return mount(token, failure(response.body.error));
    const mods = response.body;
    const saved = new Set(session.library.map(item => item.slug));
    const rail = h('aside');
    const grid = h('div', { class: 'catalog-grid', 'aria-label': libraryOnly ? 'Saved mods' : 'Mod results' });
    const count = h('span', { class: 'small muted', role: 'status' });
    const feature = !libraryOnly && backend.backend === 'mock' && mods.find(mod => mod.slug === 'coords-hud');
    const spotlight = feature ? h('article', { class: 'featured' }, hudPreview(), h('div', { class: 'feature-copy' },
      h('span', { class: 'tag' }, 'Community spotlight · sample'), h('h2', {}, 'Less HUD. More world.'),
      h('p', {}, feature.summary), h('span', { class: 'small good' }, 'HUD + player status · Free'),
      h('a', { class: 'btn primary', href: '#/mod/' + feature.slug }, 'Explore ' + feature.name, icon('arrow')))) : null;
    const search = h('input', { id: 'mod-search', type: 'search', placeholder: 'Search mods, creators or features', value: query,
      'aria-label': 'Search mods', 'data-focus-key': 'catalog:search', oninput: event => { query = event.target.value; results(); } });
    const sort = h('select', { 'aria-label': 'Sort mods', onchange: event => { order = event.target.value; results(); } },
      h('option', { value: 'recommended' }, 'Recommended'), h('option', { value: 'name' }, 'Name: A–Z'));
    sort.value = order;
    const categoryButtons = [];
    ['all', ...categories].forEach(category => {
      const control = button(category === 'all' ? 'All mods' : category, () => { selectedCategory = category; results(); }, '', 'category:' + category);
      categoryButtons.push([category, control]);
    });
    rail.append(h('div', { class: 'filter-section' }, h('p', { class: 'filter-title' }, 'Categories'),
      h('div', { class: 'filters' }, categoryButtons.map(([, control]) => control))),
    h('div', { class: 'filter-section' }, h('p', { class: 'filter-title' }, 'Permissions'),
      h('p', { class: 'small muted' }, 'See what a mod can do before adding it.'),
      h('label', { class: 'row small gap' }, h('input', { type: 'checkbox', checked: limited, onchange: event => { limited = event.target.checked; results(); } }), 'No gameplay changes')));

    /** Update just the results, keeping search, filter focus and selection intact. */
    function results() {
      let visible = M.filterMods(mods, query, '').filter(mod => (!libraryOnly || saved.has(mod.slug)) &&
        (selectedCategory === 'all' || C.category(mod) === selectedCategory) &&
        (!limited || !mod.capabilities.some(name => M.capability(name)?.sensitive)));
      if (order === 'name') visible = visible.slice().sort((a, b) => a.name.localeCompare(b.name));
      categoryButtons.forEach(([category, control]) => { control.className = category === selectedCategory ? 'active' : ''; control.setAttribute('aria-pressed', String(category === selectedCategory)); });
      count.textContent = visible.length + ' mod' + (visible.length === 1 ? '' : 's');
      if (spotlight) spotlight.hidden = Boolean(query || selectedCategory !== 'all' || limited);
      grid.replaceChildren(...visible.map(mod => h('article', { class: 'mod-card' },
        h('div', { class: 'top' }, modIcon(mod), h('div', {}, h('h3', {}, h('a', { href: '#/mod/' + mod.slug, 'data-focus-key': 'mod:' + mod.slug }, mod.name)),
          h('span', { class: 'small muted' }, mod.creator_name)), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, 'Free')),
        h('p', {}, mod.summary), h('div', { class: 'meta' }, h('span', {}, C.category(mod)),
          h('span', {}, mod.capabilities.map(name => M.capability(name)?.label || name).join(' + ') || 'No optional permissions')),
        libraryOnly && backend.backend === 'mock' ? button('Remove from library', () => removeFromLibrary(mod.slug), 'btn quiet gap', 'remove:' + mod.slug) : null)));
      if (libraryOnly) {
        for (const selection of session.library.filter(item => !mods.some(mod => mod.slug === item.slug))) {
          grid.append(h('article', { class: 'mod-card' }, h('h3', {}, selection.slug),
            h('p', {}, 'This release is unavailable. It may have been hidden or revoked.'),
            backend.backend === 'mock' ? button('Remove from library', () => removeFromLibrary(selection.slug), 'btn quiet', 'remove:' + selection.slug) : null));
        }
      }
      if (!grid.childNodes.length) grid.append(h('div', { class: 'empty' }, h('h2', {}, libraryOnly ? 'Your library is empty.' : 'No mods match.'),
        h('p', {}, libraryOnly ? 'Explore the catalogue and inspect a mod before adding it.' : 'Try another search or category.'),
        button('Clear filters', () => { query = ''; selectedCategory = 'all'; limited = false; search.value = ''; render(); }, 'btn quiet', 'catalog:recovery')));
    }
    const content = h('div', {}, h('div', { class: 'search-tools' }, h('label', { class: 'search-wrap' }, icon('search'), search), sort),
      spotlight, h('div', { class: 'row between', style: 'margin-bottom:14px' }, h('h2', {}, libraryOnly ? 'Your library' : 'Find your next addition'), count), grid);
    mount(token, h('section', { class: 'catalog-layout' }, rail, content)); results();
    if (libraryOnly && !session.account) announce('Choose an account to keep a library. Browsing is public.');
  }

  /** Draw a project page with gallery, safe description, versions and permissions. */
  async function project(token, route) {
    const response = await call('GET', '/mods/' + encodeURIComponent(route.slug));
    if (response.status !== 200) return mount(token, failure(response.body.error));
    const mod = response.body;
    const content = h('div');
    const tabs = h('nav', { class: 'tabs', 'aria-label': 'Project information' });
    const add = button('Add to Cinnabar', () => addToLibrary(mod, add), 'btn primary full', 'project:add');
    const sidebar = h('aside', { class: 'stack', style: 'align-content:start' },
      h('section', { class: 'sidebox' }, h('div', { class: 'row between' }, h('h2', {}, mod.name + ' ' + mod.version), h('span', { class: 'tag' }, 'Free')),
        h('p', { class: 'small muted' }, 'Your game asks before allowing permissions.'), add,
        h('dl', { class: 'fact-list' }, h('div', {}, h('dt', {}, 'Artifact'), h('dd', {}, 'Wasm component')),
          h('div', {}, h('dt', {}, 'Review'), h('dd', {}, mod.reviewed_by || 'Not provided')),
          h('div', {}, h('dt', {}, 'License'), h('dd', {}, mod.license || 'Not provided')))),
      h('section', { class: 'sidebox' }, h('h2', {}, 'Requested permissions'), permissions(mod, mod.grants),
        h('p', { class: 'rule small muted' }, 'Requests are not grants. Review every permission in Cinnabar before enabling a mod.')),
      button('Report a concern', () => reportForm(mod, content), 'btn quiet', 'project:report'));
    const buttons = [];
    /** Keep the selected information tab local so it does not discard catalogue state. */
    function select(tab) {
      buttons.forEach(([name, control]) => control.classList.toggle('active', name === tab));
      if (tab === 'versions') {
        content.replaceChildren(h('h2', {}, 'Releases'), h('div', { class: 'table-wrap gap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Version'), h('th', {}, 'Status'), h('th', {}, 'Reviewed by'), h('th', {}, 'Release notes'))),
          h('tbody', {}, (mod.history || []).map(version => h('tr', {}, h('td', {}, version.version),
            h('td', {}, version.pulled ? 'Pulled' : 'Approved'), h('td', {}, (version.reviewers || []).join(', ')), h('td', {}, version.notes || 'Not provided')))))));
      } else if (tab === 'permissions') {
        content.replaceChildren(h('h2', {}, 'Permissions & checks'), permissions(mod, mod.grants),
          h('div', { class: 'notice gap' }, 'Approval records and browser syntax checks are not malware scans. Server scanning is not connected in this preview.'),
          h('dl', { class: 'facts' }, h('dt', {}, 'SHA-256'), h('dd', {}, mod.sha256), h('dt', {}, 'Size'), h('dd', {}, mod.bytes + ' bytes')));
      } else {
        const gallery = h('div');
        const images = (Array.isArray(mod.gallery) ? mod.gallery : []).filter(item => C.imageUrl(item.url));
        if (images.length) {
          const picture = h('img', { class: 'gallery-picture', src: C.imageUrl(images[0].url), alt: images[0].alt || '', referrerpolicy: 'no-referrer' });
          const caption = h('p', { class: 'gallery-caption' }, images[0].caption || '');
          gallery.append(picture, caption, h('div', { class: 'gallery-thumbs' }, images.map((item, i) => button(item.caption || 'Image ' + (i + 1), () => {
            picture.src = C.imageUrl(item.url); picture.alt = item.alt || ''; caption.textContent = item.caption || '';
          }, 'btn quiet', 'gallery:' + i))));
        } else gallery.append(h('div', { class: 'empty' }, h('p', {}, 'No screenshots uploaded.')));
        content.replaceChildren(gallery, h('p', { class: 'gap soft' }, mod.summary), C.markdown(document, mod.description));
        const source = C.externalUrl(mod.source);
        if (source) content.append(h('a', { class: 'btn quiet gap', href: source, rel: 'noopener noreferrer' }, 'View source'));
      }
    }
    for (const [name, label] of [['description', 'Description & gallery'], ['versions', 'Versions'], ['permissions', 'Permissions & checks']]) {
      const control = button(label, () => select(name), '', 'detail:' + name); tabs.append(control); buttons.push([name, control]);
    }
    select('description');
    mount(token, h('section', {}, h('a', { class: 'back', href: '#/' }, 'Back to mods'),
      h('div', { class: 'project-heading' }, modIcon(mod), h('div', {}, h('h1', {}, mod.name), h('p', {}, mod.summary),
        h('div', { class: 'tags' }, h('span', { class: 'small muted' }, 'by ' + mod.creator_name), h('span', { class: 'tag' }, C.category(mod)),
          h('span', { class: 'tag' }, 'Free')))), tabs, h('div', { class: 'detail-layout' }, content, sidebar)));
    document.title = mod.name + ' · Cinnabar';
  }

  /** Report a selected release with a labelled inline form and server error recovery. */
  function reportForm(mod, content) {
    if (!session.account) return signIn();
    const reason = h('select', { id: 'report-reason' }, ['broken', 'advantage', 'malicious', 'stolen', 'other'].map(value => h('option', { value }, value)));
    const details = h('textarea', { id: 'report-details', minlength: 10, maxlength: 1000, required: true });
    const error = h('p', { class: 'error', role: 'alert' });
    content.replaceChildren(h('h2', {}, 'Report ' + mod.name), h('form', { class: 'gap', onsubmit: async event => {
      event.preventDefault();
      const result = await call('POST', '/mods/' + encodeURIComponent(mod.slug) + '/reports', { reason: reason.value, details: details.value });
      if (result.status !== 200) { error.textContent = result.body.error; return; }
      announce('Report received.'); render();
    } }, h('label', { class: 'field', for: 'report-reason' }, 'Reason', reason),
    h('label', { class: 'field', for: 'report-details' }, 'What happened?', details), error, h('button', { class: 'btn primary', type: 'submit' }, 'Send report')));
    reason.focus();
  }

  /** Restore only draft fields for this account; artifact bytes are never stored in browser storage. */
  function loadDraft() {
    const owner = session.account.xuid;
    if (draft && owner === draftOwner) return;
    draftOwner = owner;
    let saved;
    try { saved = JSON.parse(safeStorage().getItem('cinnabar.marketplace.draft.' + owner)); } catch (_) { saved = null; }
    const initial = { name: '', slug: '', summary: '', description: '', category: 'Interface', license: '', version: '', source: '', notes: '', gallery: [] };
    draft = Object.assign(initial, saved && typeof saved === 'object' ? Object.fromEntries(Object.keys(initial).map(key => [key, saved[key] ?? initial[key]])) : {});
    draft.gallery = Array.isArray(draft.gallery) ? draft.gallery.filter(item => item && C.imageUrl(item.url)).slice(0, 12) : [];
    draft.file = null; draft.parsed = null; draft.check = null;
  }

  /** Save this account's editable draft; quota failure leaves the current form intact. */
  function saveDraft() {
    const data = { ...draft }; delete data.file; delete data.parsed; delete data.check;
    try { safeStorage().setItem('cinnabar.marketplace.draft.' + draftOwner, JSON.stringify(data)); announce('Draft saved in this browser. Reselect the release file after reloading.'); }
    catch (_) { announce('Browser storage is unavailable or full. Your current draft remains open; enable storage or remove images before retrying.', true); }
  }

  /** Keep image decoders and storage bounded; persist only re-encoded raster derivatives. */
  async function readImage(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choose PNG, JPEG or WebP images up to 8 MiB each.');
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 24000000) throw new Error('Images must have at most 24 megapixels.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/webp', 0.8);
      if (url.length > 360000) throw new Error('This preview image is too large. Resize or simplify it and retry.');
      return { url, caption: file.name.replace(/\.[^.]+$/, '').slice(0, 140), alt: '' };
    } finally { bitmap.close(); }
  }

  /** Check both declarations and the complete component before accepting a release file. */
  async function takeFile(file) {
    validationController?.abort();
    validationController = new AbortController();
    const signal = validationController.signal;
    const token = ++fileToken;
    const owner = draftOwner;
    validationPending = true; draft.file = null; draft.parsed = null; draft.check = null;
    announce('Checking the component structure. Uploaded code is not executed.');
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('The file is over 16 MiB.');
      const bytes = await file.arrayBuffer();
      const parsed = M.readComponent(bytes);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const check = await window.CinnabarValidation.validate(bytes.slice(0), { signal });
      if (token !== fileToken || owner !== draftOwner) return;
      draft.file = file; draft.parsed = { ...parsed, sha256: digest, bytes: file.size }; draft.check = check;
      for (const key of ['name', 'version', 'description']) if (!draft[key]) draft[key] = parsed[key] || '';
      if (!draft.summary) draft.summary = parsed.description.slice(0, 140);
      announce('Component syntax checks passed. This is not a malware scan.');
    } catch (error) {
      if (token === fileToken && owner === draftOwner) announce(error.message || String(error), true);
    } finally {
      if (token === fileToken && owner === draftOwner) { validationPending = false; render(); }
    }
  }

  /** Build the creator's four-step editor, keeping every local field across step changes. */
  async function editor(token) {
    if (!session.account) return mount(token, h('section', { class: 'empty' }, h('h2', {}, 'Give your mod a home.'),
      h('p', {}, 'Sign in to prepare a project and submit a release.'), button(backend.backend === 'mock' ? 'Choose a preview account' : 'Sign in with Microsoft', signIn, 'btn primary', 'editor:signin')));
    loadDraft();
    const form = h('form', { class: 'editor', novalidate: true });
    const panel = h('div');
    const previewName = h('h3', {}, draft.name || 'Your mod');
    const previewSummary = h('p', {}, draft.summary || 'Your summary appears here.');
    const preview = h('aside', { class: 'editor-aside' }, h('p', { class: 'small muted', style: 'margin-bottom:12px' }, 'Listing preview'),
      h('div', { class: 'preview-card' }, modIcon({ capabilities: [], category: draft.category }), previewName,
        h('span', { class: 'small muted' }, session.account.gamertag), previewSummary, h('span', { class: 'tag' }, 'Free')),
      h('p', { class: 'rule small muted' }, 'Drafts are private to this account in this browser. Nothing is published until the service approves a release.'));
    const stepButtons = steps.map((name, index) => h('li', {}, button(h('span', { class: 'row' }, h('span', { class: 'num' }, index + 1),
      ['Project', 'Images', 'Release', 'Checks & publish'][index]), () => { step = name; render(); }, step === name ? 'active' : '', 'step:' + name)));
    /** Bind a labelled input to the draft without replacing focused controls. */
    function field(key, label, type = 'text', hint = '') {
      const input = h(type === 'textarea' ? 'textarea' : 'input', { id: 'draft-' + key, name: key, type: type === 'textarea' ? null : type,
        value: draft[key], maxlength: key === 'description' ? (backend.backend === 'http' ? 2000 : 40000) : key === 'summary' ? 140 : key === 'name' ? 64 : 2000,
        oninput: event => { draft[key] = event.target.value; if (key === 'name') previewName.textContent = draft.name; if (key === 'summary') previewSummary.textContent = draft.summary; } });
      return h('label', { class: 'field', for: 'draft-' + key }, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
    }
    if (step === 'project') {
      panel.append(h('h2', {}, 'Tell players what it does.'), field('name', 'Project name'), field('slug', 'Project address', 'text', '3–40 lowercase letters, numbers and dashes.'),
        field('summary', 'Summary', 'text', 'One clear sentence shown in search results.'), field('description', 'Description', 'textarea', 'Markdown headings, lists, bold text, code and HTTPS links are supported. HTML stays plain text.'),
        button('Preview description', () => descriptionPreview.replaceChildren(C.markdown(document, draft.description)), 'btn quiet', 'draft:preview'));
      const descriptionPreview = h('div'); panel.append(descriptionPreview);
      const select = h('select', { id: 'draft-category', onchange: event => { draft.category = event.target.value; } }, categories.map(name => h('option', { value: name }, name)));
      select.value = draft.category;
      panel.append(h('div', { class: 'two gap' }, h('label', { class: 'field', for: 'draft-category' }, 'Category', select), field('license', 'License', 'text', 'For example MIT or All rights reserved.')),
        field('source', 'Source repository', 'url', 'A GitHub repository is required for gameplay and packet permissions.'));
    } else if (step === 'media') {
      panel.append(h('h2', {}, 'Show it in action.'), h('p', { class: 'small muted', style: 'margin-bottom:20px' }, 'Upload screenshots with captions and alt text. Preview images are resized and stripped of metadata.'));
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, 'aria-label': 'Choose project images', disabled: mediaPending,
        onchange: async event => {
          const owner = draftOwner;
          const current = draft;
          const files = Array.from(event.target.files || []);
          mediaPending = true;
          input.disabled = true;
          try {
            if (current.gallery.length + files.length > 12) throw new Error('A project can have at most 12 images.');
            const images = [];
            for (const file of files) images.push(await readImage(file));
            if (owner !== draftOwner || current !== draft) return;
            if (JSON.stringify(current.gallery.concat(images)).length > 2000000) throw new Error('The preview gallery is limited to 2 MiB. Remove an image and retry.');
            current.gallery.push(...images); announce('Images added to your draft in this browser.');
          } catch (error) { if (owner === draftOwner) announce(error.message, true); }
          finally { if (owner === draftOwner && current === draft) { mediaPending = false; render(); } }
        } });
      panel.append(h('div', { class: 'upload-zone' }, icon('upload'), h('b', {}, mediaPending ? 'Preparing images…' : 'Choose project images'),
        h('span', { class: 'small muted' }, 'PNG, JPEG or WebP · up to 8 MiB and 24 megapixels each'), input));
      const media = h('div', { class: 'media-strip' }, draft.gallery.map((image, index) => {
        const caption = h('input', { value: image.caption, maxlength: 140, 'aria-label': 'Caption for image ' + (index + 1), oninput: event => { image.caption = event.target.value; } });
        const alt = h('input', { value: image.alt, maxlength: 300, 'aria-label': 'Alt text for image ' + (index + 1), oninput: event => { image.alt = event.target.value; } });
        return h('div', { class: 'media-item' }, h('div', { class: 'media-tile' }, h('img', { src: C.imageUrl(image.url), alt: image.alt || 'Draft image ' + (index + 1) }),
          button('Remove', () => { draft.gallery.splice(index, 1); render(); }, 'quiet', 'image:remove:' + index)),
        h('label', { class: 'field' }, 'Caption', caption), h('label', { class: 'field' }, 'Alt text', alt));
      })); panel.append(media);
      if (backend.backend === 'http') panel.append(h('div', { class: 'notice' }, 'This API does not support project image uploads yet. Keep images in your local draft or remove them before submitting.'));
    } else if (step === 'release') {
      panel.append(h('h2', {}, 'Add a release.'), h('div', { class: 'upload-zone' }, icon('upload'), h('b', {}, validationPending ? 'Checking component…' : 'Choose your Wasm component'),
        h('span', { class: 'small muted' }, 'Portable .wasm component · up to 16 MiB'), h('input', { type: 'file', accept: '.wasm', 'aria-label': 'Choose mod component',
          onchange: event => { const file = event.target.files?.[0]; if (file) takeFile(file); } })),
      draft.file ? h('p', { class: 'small good gap' }, draft.file.name + ' · syntax checked') : h('p', { class: 'small muted gap' }, 'Select a file for this session. No uploaded code is executed.'),
      field('version', 'Version', 'text', 'Use SemVer, for example 1.2.0.'), field('notes', 'Release notes', 'textarea'));
      if (draft.parsed) panel.append(permissions({ capabilities: M.requestedCapabilities(draft.parsed.grants) }, draft.parsed.grants));
    } else {
      const checked = Boolean(draft.file && draft.parsed && draft.check);
      panel.append(h('h2', {}, 'Ready when the checks are.'), h('p', { class: 'small muted' }, 'Established creators can publish automatically only when the service confirms eligibility and completes the required checks.'),
        h('div', { class: 'scan-status' }, h('div', {}, h('span', {}, 'Browser component syntax'), h('span', { class: checked ? 'good' : 'warning' }, checked ? 'Passed' : validationPending ? 'Checking…' : 'Choose a release file')),
          h('div', {}, h('span', {}, 'Server malware / AI review'), h('span', { class: 'muted' }, 'Not connected')),
          h('div', {}, h('span', {}, 'Automatic publication'), h('span', { class: 'muted' }, 'Unavailable')),
          h('div', {}, h('span', {}, 'Publication route'), h('span', {}, 'Submit for review'))),
        h('div', { class: 'notice gap' }, backend.backend === 'mock' ? 'Preview submissions stay in this browser. Staff decisions simulate publication; they do not distribute code.' : 'The service must independently validate and review the artifact. A browser check cannot authorize publication.'),
        h('label', { class: 'row gap small' }, h('input', { type: 'checkbox', id: 'distribution-rights' }), 'I have permission to distribute this code and these images.'));
    }
    form.append(panel, h('div', { class: 'editor-actions' }, button('Save draft', saveDraft, 'btn quiet', 'draft:save'),
      h('button', { type: 'submit', class: 'btn primary', 'data-focus-key': 'draft:continue', disabled: validationPending || mediaPending },
        step === 'checks' ? 'Submit for review' : ['Continue to images', 'Continue to release', 'Review checks'][steps.indexOf(step)])));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (validationPending || mediaPending) return announce('Wait for the current file check to finish.', true);
      if (step !== 'checks') { step = steps[steps.indexOf(step) + 1]; render(); return; }
      if (!draft.file || !draft.parsed || !draft.check) { step = 'release'; await render(); return announce('Choose a valid component file first.', true); }
      if (!document.getElementById('distribution-rights').checked) return announce('Confirm your distribution rights before submitting.', true);
      const fields = { name: draft.name.trim(), slug: draft.slug.trim(), summary: draft.summary.trim(), description: draft.description,
        version: draft.version.trim(), source: draft.source.trim(), reach: M.reachOf(draft.parsed.grants) };
      const errors = M.validateListing(fields);
      if (Object.keys(errors).length) { step = 'project'; await render(); announce(Object.values(errors).join(' '), true); return; }
      if (backend.backend === 'http' && draft.gallery.length) return announce('This API cannot publish images yet. Keep a separate draft or remove the images before submitting.', true);
      const submit = form.querySelector('[type=submit]'); submit.disabled = true;
      const owner = draftOwner;
      let result;
      try {
        result = backend.submit ? await backend.submit(fields, draft.file) : await call('POST', '/submissions', {
          ...fields, category: draft.category, license: draft.license, notes: draft.notes, gallery: draft.gallery,
          grants: draft.parsed.grants || {}, sha256: draft.parsed.sha256, bytes: draft.file.size,
        });
      } catch (_) { result = { status: 0, body: { error: 'Upload failed. Your draft is still here; retry when connected.' } }; }
      if (owner !== draftOwner) return;
      submit.disabled = false;
      if (result.status !== 200) return announce(result.body.error, true);
      announce(backend.backend === 'mock' ? 'Preview release submitted for review. No file was distributed.' : 'Release submitted for server review.');
      safeStorage().removeItem('cinnabar.marketplace.draft.' + owner);
      draft = null; step = 'project'; location.hash = '#/mine';
    });
    mount(token, h('section', {}, h('div', { class: 'editor-heading' }, h('div', {}, h('h1', {}, 'Give your mod a home.'), h('p', { class: 'muted' }, 'Publishing as ' + session.account.gamertag))),
      h('div', { class: 'editor-layout' }, h('aside', {}, h('ol', { class: 'steps' }, stepButtons)), form, preview)));
  }

  /** Display immutable submitted releases and any staff note without fabricating scans. */
  async function mine(token) {
    if (!session.account) return editor(token);
    const result = await call('GET', '/me/mods');
    if (result.status !== 200) return mount(token, failure(result.body.error));
    mount(token, h('section', {}, h('div', { class: 'editor-heading' }, h('h1', {}, 'Your projects'), h('a', { href: '#/submit', class: 'btn primary' }, 'Prepare a release')),
      result.body.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Project', 'Version', 'Status', 'Staff note'].map(label => h('th', {}, label)))),
        h('tbody', {}, result.body.map(version => h('tr', {}, h('td', {}, version.name), h('td', {}, version.version),
          h('td', {}, version.pulled ? 'Pulled' : version.status), h('td', {}, version.note || '—')))))) : h('p', { class: 'empty' }, 'No submitted releases yet. Your draft is available in Publish a mod.')));
  }

  /** Require staff identity and preserve each failed workspace request as an error state. */
  async function staff(token, route) {
    if (!M.atLeast(session.account, 'moderator')) return mount(token, h('section', { class: 'empty' }, h('h2', {}, 'Review workspace'),
      h('p', {}, 'Sign in with a moderator or administrator account to continue.'), !session.account ? button('Sign in', signIn, 'btn primary') : null));
    const tabs = h('nav', { class: 'tabs', 'aria-label': 'Staff workspace' }, [['queue', 'Review queue'], ['reports', 'Reports'], ['people', 'People'], ['audit', 'Audit history']].map(([tab, label]) =>
      h('a', { href: '#/staff/' + tab, 'aria-current': route.tab === tab ? 'page' : null }, label)));
    const body = h('div');
    const response = await call('GET', '/staff/' + route.tab);
    if (response.status !== 200) body.append(failure(response.body.error));
    else if (route.tab === 'queue') await reviewQueue(body, response.body, route.id, token);
    else if (route.tab === 'reports') staffReports(body, response.body);
    else if (route.tab === 'people') staffPeople(body, response.body);
    else staffAudit(body, response.body);
    mount(token, h('section', {}, h('div', { class: 'editor-heading' }, h('div', {}, h('h1', {}, 'Review the evidence.'),
      h('p', { class: 'muted' }, 'Every decision is recorded. AI findings require evidence.'))), tabs, body));
  }

  /** Compute value-level changes from raw grants, ignoring an API's name-only diff. */
  function permissionDiff(version) {
    if (!version.previous) return null;
    return version.previous.grants ? M.grantDiff(version.previous.grants, version.grants) : version.previous.diff;
  }

  /** Build review evidence and role-checked actions for the selected exact release. */
  async function reviewQueue(body, queue, selected, token) {
    if (!queue.length) { body.append(h('p', { class: 'empty' }, 'No versions are waiting for review.')); return; }
    const id = selected || queue[0].id;
    const result = await call('GET', '/staff/versions/' + encodeURIComponent(id));
    if (token !== generation) return;
    if (result.status !== 200) { body.append(failure(result.body.error)); return; }
    const version = result.body;
    const diff = permissionDiff(version);
    const notes = h('textarea', { id: 'review-note', placeholder: 'Explain the decision or requested change.', maxlength: 2000 });
    const approve = M.can(session.account, 'approve', { version });
    if (approve.ok && version.previous && version.grants?.commands?.length && !version.previous.grants && !diff?.commands) {
      approve.ok = false;
      approve.reason = 'This API does not provide the previous command values. Upgrade the API before approving command-bearing updates.';
    }
    const allowed = M.can(session.account, 'review', { version });
    const decisionStatus = h('p', { class: 'error', role: 'alert' });
    /** Commit a review decision only to the selected version, retaining a failed note. */
    async function decide(decision, control) {
      control.disabled = true;
      const response = await call('POST', '/staff/versions/' + encodeURIComponent(version.id) + '/decision', { decision, note: notes.value });
      control.disabled = false;
      if (response.status !== 200) { decisionStatus.textContent = response.body.error; notes.focus(); return; }
      location.hash = '#/staff/queue'; await render(); announce('Review decision recorded for ' + version.name + ' ' + version.version + '.');
    }
    const decisions = h('div', { class: 'stack gap' });
    for (const [decision, label] of [['changes', 'Request changes'], ['approve', 'Approve release'], ['reject', 'Reject release']]) {
      const control = button(label, () => decide(decision, control), decision === 'changes' ? 'btn primary' : 'btn quiet', 'decision:' + decision);
      control.disabled = decision === 'approve' ? !approve.ok : !allowed.ok;
      decisions.append(control);
    }
    const review = h('div', {}, h('div', { class: 'review-top' }, h('div', {}, h('h2', {}, version.name + ' ' + version.version),
      h('p', { class: 'small muted' }, 'by ' + version.creator_name + (version.previous ? ' · Compare with ' + version.previous.version : ' · First release'))),
      h('span', { class: 'tag warning' }, 'Human review required')),
    h('div', { class: 'review-columns' }, h('div', {},
      h('div', { class: 'notice' }, h('b', {}, 'Server scan evidence is not connected.'),
        h('p', {}, 'The permission diff below is deterministic. Approval in the preview simulates a staff decision; it does not certify code safety.')),
      h('h3', { class: 'gap' }, 'Requested permissions'), permissions(version, version.grants),
      diff ? h('section', { class: 'rule' }, h('h3', {}, 'Changes from ' + version.previous.version),
        h('p', { class: 'small gap' }, 'Added: ' + (diff.added.join(', ') || 'None')),
        h('p', { class: 'small' }, 'Removed: ' + (diff.removed.join(', ') || 'None')),
        diff.commands ? h('div', { class: 'code-block gap' }, 'Commands added: ' + (diff.commands.added.join(', ') || 'None') + '\nCommands removed: ' + (diff.commands.removed.join(', ') || 'None'))
          : h('p', { class: 'warning small gap' }, 'This API response does not include command-value changes. Compare the exact grant lists before approving.'),
        diff.expanded ? h('p', { class: 'warning small gap' }, 'This release expands authority and cannot publish automatically.') : null) : null,
      h('dl', { class: 'facts' }, h('dt', {}, 'Artifact SHA-256'), h('dd', {}, version.sha256),
        h('dt', {}, 'Approvals'), h('dd', {}, version.approvals.map(person => person.gamertag || person.xuid).join(', ') || 'None'),
        h('dt', {}, 'Source'), h('dd', {}, C.externalUrl(version.source) ? h('a', { href: C.externalUrl(version.source), rel: 'noopener noreferrer' }, version.source) : 'Not linked'))),
    h('aside', { class: 'verdict' }, h('h3', {}, 'Decision'), h('p', { class: 'small muted gap' }, approve.ok ? 'Compare the file, permissions and description before approving.' : approve.reason),
      h('label', { class: 'field gap', for: 'review-note' }, 'Note to creator', notes), decisions, decisionStatus,
      h('p', { class: 'small muted gap' }, 'No self-review. Every decision is tied to this version.'))));
    body.append(h('div', { class: 'review-layout' }, h('aside', { class: 'queue' }, queue.map(entry => h('a', {
      href: '#/staff/queue/' + entry.id, class: entry.id === id ? 'active' : '', 'data-focus-key': 'queue:' + entry.id,
    }, h('strong', {}, entry.name + ' ' + entry.version), h('span', { class: 'tag' }, M.RUNGS[entry.reach]?.label || 'Unknown'),
    h('p', { class: 'small muted' }, entry.creator_name)))), review));
  }

  /** Keep report triage and revocation actions visibly distinct from review approvals. */
  function staffReports(body, reports) {
    if (!reports.length) { body.append(h('p', { class: 'empty' }, 'No reports.')); return; }
    body.append(h('div', { class: 'stack' }, reports.map(report => {
      const note = h('textarea', { 'aria-label': 'Resolution for ' + report.name, maxlength: 2000 });
      const error = h('p', { class: 'error', role: 'alert' });
      const actions = h('div', { class: 'review-actions' });
      if (report.status !== 'resolved') actions.append(button('Resolve report', async () => {
        const result = await call('POST', '/staff/reports/' + report.id + '/resolve', { note: note.value });
        if (result.status !== 200) { error.textContent = result.body.error; return; } render(); announce('Report resolved.');
      }, 'btn primary'));
      if (M.can(session.account, 'pull').ok && report.version_id && !report.pulled && report.status !== 'resolved') actions.append(button('Pull release', async () => {
        const result = await call('POST', '/staff/versions/' + report.version_id + '/pull', { reason: note.value });
        if (result.status !== 200) { error.textContent = result.body.error; return; } render(); announce('Release pulled.');
      }));
      return h('article', { class: 'sidebox' }, h('h2', {}, report.name + ' ' + report.version),
        h('p', { class: 'small muted gap' }, report.reason + ' · ' + report.reporter_name + ' · ' + report.status), h('p', { class: 'gap' }, report.details),
        report.status === 'resolved' ? h('p', { class: 'small gap' }, report.resolved_by_name + ': ' + report.resolution) : h('label', { class: 'field gap' }, 'Resolution / pull reason', note), actions, error);
    })));
  }

  /** Expose role administration while keeping the API as the authorization boundary. */
  function staffPeople(body, people) {
    const name = h('input', { id: 'staff-name', required: true, maxlength: 64 });
    const role = h('select', { id: 'staff-role' }, ['player', 'moderator', 'admin'].map(value => h('option', { value }, value)));
    const reason = h('textarea', { id: 'staff-reason', required: true, maxlength: 2000 });
    const error = h('p', { class: 'error', role: 'alert' });
    body.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Gamertag'), h('th', {}, 'Role'))),
      h('tbody', {}, people.map(person => h('tr', {}, h('td', {}, person.gamertag), h('td', {}, person.role)))))),
    M.atLeast(session.account, 'admin') ? h('form', { class: 'sidebox gap', onsubmit: async event => {
      event.preventDefault(); const result = await call('POST', '/staff/people/role', { gamertag: name.value, role: role.value, reason: reason.value });
      if (result.status !== 200) { error.textContent = result.body.error; return; } await loadSession(); render(); announce('Staff assignment updated.');
    } }, h('h2', {}, 'Change a staff assignment'), h('label', { class: 'field gap', for: 'staff-name' }, 'Gamertag', name),
    h('label', { class: 'field', for: 'staff-role' }, 'Role', role), h('label', { class: 'field', for: 'staff-reason' }, 'Reason', reason), error,
    h('button', { type: 'submit', class: 'btn primary' }, 'Save assignment')) : null);
  }

  /** Show named, attributable audit rows without interpreting staff notes as HTML. */
  function staffAudit(body, entries) {
    body.append(entries.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Who', 'Action', 'Target', 'Note'].map(name => h('th', {}, name)))),
      h('tbody', {}, entries.map(entry => h('tr', {}, h('td', {}, entry.actor_name), h('td', {}, entry.action), h('td', {}, entry.target), h('td', {}, entry.note))))))
      : h('p', { class: 'empty' }, 'No audit entries.'));
  }

  /** Render only the most recent route; late responses cannot replace a newer screen. */
  async function render() {
    const token = ++generation;
    const route = M.parseRoute(location.hash);
    chrome(route);
    document.title = 'Marketplace · Cinnabar';
    try {
      if (route.view === 'catalogue' || route.view === 'library') await catalogue(token, route.view === 'library');
      else if (route.view === 'mod') await project(token, route);
      else if (route.view === 'submit') await editor(token);
      else if (route.view === 'mine') await mine(token);
      else await staff(token, route);
    } catch (_) { mount(token, failure('The response could not be displayed. Please retry.')); }
  }

  document.querySelector('[data-close]').addEventListener('click', () => document.getElementById('signin-dialog').close());
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  document.getElementById('preview-note').hidden = backend.backend !== 'mock';
  document.getElementById('reset-preview').addEventListener('click', async () => {
    backend.reset(); validationController?.abort(); validationPending = false; mediaPending = false; fileToken++; draft = null; draftOwner = null; await loadSession(); await render(); announce('Sample data restored.');
  });
  const signInError = new URLSearchParams(location.search).get('signin_error');
  if (signInError) {
    const messages = { cancelled: 'Sign-in was cancelled.', child_account: 'Xbox family settings must allow this account to sign in.',
      no_xbox_profile: 'This Microsoft account does not have an Xbox profile.', xbox_unavailable: 'Xbox sign-in is unavailable. Retry shortly.' };
    announce(messages[signInError] || 'Sign-in could not finish. Please retry.', true);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  loadSession().then(result => { if (result.status !== 200) announce(result.body.error, true); return render(); });
})();
