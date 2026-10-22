/* Browser-local marketplace demonstration. No account or artifact requests. */
(function () {
  'use strict';

  const storageKey = 'cinnabar.marketplace.demo.v1';
  const workspace = document.getElementById('workspace');
  const feedback = document.getElementById('feedback');
  const roleSelect = document.getElementById('demo-role');
  let model;
  let view = 'browse';
  let selectedId = null;
  let editingId = null;
  let reviewId = null;
  let query = '';
  let category = '';
  let storageAvailable = true;

  /** Create text-bearing elements without interpreting catalog or form HTML. */
  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  /** Render labels shared by status indicators and action controls. */
  function label(value) {
    const text = String(value).replaceAll('_', ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Return an authored line icon; unknown catalog icons use the generic mod mark. */
  function icon(name, tone = '') {
    const paths = {
      zoom: '<path d="M4 10V4h6M22 4h6v6M28 22v6h-6M10 28H4v-6"/><circle cx="16" cy="16" r="6"/><path d="m20 20 4 4"/>',
      layout: '<rect x="4" y="5" width="24" height="22" rx="1"/><path d="M4 12h24M13 12v15M8 9h1M12 9h1M16 9h1"/>',
      sun: '<path d="M3 24h26M7 20a9 9 0 0 1 18 0M16 3v4M4 9l3 3M28 9l-3 3M2 17h4M26 17h4M11 29h10"/>',
      compass: '<circle cx="16" cy="16" r="12"/><path d="m20 12-2 6-6 2 2-6zM16 1v3M16 28v3M1 16h3M28 16h3"/>',
      mod: '<rect x="5" y="5" width="22" height="22" rx="1"/><path d="M11 11h10v10H11zM16 5v6M16 21v6M5 16h6M21 16h6"/>',
      shield: '<path d="m16 3 10 4v8c0 7-10 13-10 13S6 22 6 15V7zM11 15l4 4 7-8"/>'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'square');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `mod-icon tone-${tone}`);
    svg.innerHTML = Object.hasOwn(paths, name) ? paths[name] : paths.mod;
    return svg;
  }

  /** Create a button with an explicit action, bypassing implicit form submission. */
  function button(text, action, className = '', focusKey = '') {
    const result = node('button', className, text);
    result.type = 'button';
    if (focusKey) result.dataset.focusKey = focusKey;
    result.addEventListener('click', action);
    return result;
  }

  /** Restore a replaced control, or hand focus to its selected entry or workspace. */
  function restoreFocus(previous) {
    const key = previous?.dataset.focusKey;
    if (!key || previous.isConnected) return;
    const controls = [...document.querySelectorAll('[data-focus-key]')];
    let successor;
    if (view === 'creator') successor = `creator:entry:${editingId}`;
    else if (view === 'review') successor = `review:entry:${reviewId}`;
    else if (view === 'browse' || view === 'library') successor = `catalog:library:${selectedId}`;
    for (const candidate of [key, successor, 'catalog:recovery', `nav:${view}`]) {
      const control = controls.find(item => item.dataset.focusKey === candidate && !item.disabled);
      if (control) {
        control.focus();
        return;
      }
    }
  }

  /** Announce local action outcomes in a persistent live region. */
  function announce(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
  }

  /** Save demo state when storage is available; remain usable when it is blocked. */
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(model.exportState()));
    } catch {
      storageAvailable = false;
    }
  }

  /** Run a model mutation, keep its outcome visible, and preserve invalid forms. */
  function mutate(action, message, refresh = true) {
    try {
      const result = action();
      persist();
      if (refresh) render();
      announce(message + (storageAvailable ? '' : ' Storage is unavailable; this change lasts for this page session.'));
      return result;
    } catch (error) {
      announce(error.message, true);
      return null;
    }
  }

  /** Add an informative empty state, optionally with a recovery action. */
  function empty(title, text, actionText, action) {
    const result = node('div', 'empty');
    result.append(node('h2', '', title), node('p', '', text));
    if (action) result.append(button(actionText, action, '', 'catalog:recovery'));
    return result;
  }

  /** Navigate the local workspace without pretending a server route is protected. */
  function navigate(next) {
    view = next;
    query = '';
    category = '';
    announce('');
    render();
  }

  /** Derive visible workspaces from the shared capability policy. */
  function renderNavigation() {
    const sections = [['browse', 'Explore'], ['library', `Demo library (${model.library().length})`]];
    if (model.can('submission.create')) sections.push(['creator', 'Creator workspace']);
    if (model.can('submission.review')) sections.push(['review', 'Review queue']);
    if (model.can('staff.manage')) sections.push(['staff', 'Staff & audit']);
    if (view !== 'signin' && !sections.some(([id]) => id === view)) view = 'browse';
    document.getElementById('workspace-nav').replaceChildren(...sections.map(([id, text]) => {
      const control = button(text, () => navigate(id), '', `nav:${id}`);
      if (id === view) control.setAttribute('aria-current', 'page');
      return control;
    }));
    roleSelect.value = model.actor.role;
    document.getElementById('role-indicator').textContent = `Local demo · ${label(model.actor.role)}`;
  }

  /** Render the current local workspace and role indicator. */
  function render() {
    const focused = document.activeElement;
    renderNavigation();
    workspace.replaceChildren();
    if (view === 'browse' || view === 'library') renderStore();
    else if (view === 'creator') renderCreator();
    else if (view === 'review') renderReview();
    else if (view === 'staff') renderStaff();
    else renderSignIn();
    restoreFocus(focused);
  }

  /** Return a listing detail with requested capabilities ahead of its library action. */
  function detail(entry, libraryAction = true) {
    const result = node('section', 'detail');
    result.setAttribute('aria-label', `${entry.title} details`);
    const top = node('div', 'detail-top');
    top.append(icon(entry.icon, entry.tone), node('span', 'badge', libraryAction && entry.status === 'published' ? 'Free community mod' : label(entry.status)));
    result.append(top, node('h2', '', entry.title), node('p', 'byline', `By ${entry.creator}`), node('p', 'description', entry.description));
    const metadata = node('dl', 'metadata');
    for (const [term, value] of [['Version', entry.version], ['Category', entry.category], ['License', entry.license || 'Not specified']]) {
      const group = node('div');
      group.append(node('dt', '', term), node('dd', '', value));
      metadata.append(group);
    }
    const permissions = node('section', 'permission-section');
    permissions.append(node('h3', '', 'Requested permissions'));
    const list = node('ul');
    for (const permission of entry.permissions) {
      const item = node('li');
      item.append(icon('shield'), node('span', '', permission));
      list.append(item);
    }
    permissions.append(list, node('p', 'hint', 'Sample declarations only. Mod execution and permission enforcement are not connected.'));
    result.append(metadata, permissions);
    if (libraryAction) {
      const added = model.library().includes(entry.id);
      if (entry.status !== 'published') result.append(node('p', 'notice', `${label(entry.status)} · This mod is unavailable. You can remove its saved selection from your demo library.`));
      const control = button(added ? 'Remove from demo library' : 'Add to demo library', () => {
        mutate(() => model.toggleLibrary(entry.id, Date.now()), added ? `${entry.title} removed from your demo library.` : `${entry.title} added to your demo library. No files were downloaded.`);
        const replacement = workspace.querySelector('.detail button') || workspace.querySelector('[data-focus-key="catalog:recovery"]');
        if (replacement) replacement.focus();
      }, added ? '' : 'primary', `catalog:library:${entry.id}`);
      result.append(control, node('p', 'hint', 'Saved in this browser only. Nothing is downloaded or installed.'));
    }
    return result;
  }

  /** Render discovery filters once so typing preserves the input and selection. */
  function renderStore() {
    const toolbar = node('div', 'catalog-toolbar');
    const searchLabel = node('label', 'search-field', 'Search mods');
    const search = node('input');
    search.type = 'search';
    search.dataset.focusKey = 'catalog:search';
    search.placeholder = 'Search by name, creator or feature';
    search.value = query;
    searchLabel.append(search);
    const categoryLabel = node('label', '', 'Category');
    const select = node('select');
    select.dataset.focusKey = 'catalog:category';
    const all = node('option', '', 'All categories');
    all.value = '';
    select.append(all);
    const available = view === 'library' ? model.libraryEntries() : model.search();
    for (const value of [...new Set(available.map(entry => entry.category))].sort()) {
      const option = node('option', '', value);
      option.value = value;
      select.append(option);
    }
    select.value = category;
    categoryLabel.append(select);
    toolbar.append(searchLabel, categoryLabel);
    const region = node('div');
    region.id = 'catalog-results';
    workspace.append(toolbar, region);
    search.addEventListener('input', () => { query = search.value; renderCatalog(); });
    select.addEventListener('change', () => { category = select.value; renderCatalog(); });
    renderCatalog();
  }

  /** Keep the selected detail next to results, and immediately after its card on phones. */
  function renderCatalog(focusSelection = false) {
    const region = document.getElementById('catalog-results');
    if (!region) return;
    const entries = view === 'library' ? model.libraryEntries(query, category) : model.search(query, category);
    if (!entries.some(entry => entry.id === selectedId)) selectedId = entries[0]?.id ?? null;
    const summary = node('div', 'results-label');
    summary.append(node('span', '', `${entries.length} ${entries.length === 1 ? 'mod' : 'mods'}${view === 'library' ? ' in your demo library' : ' to explore'}`), node('span', '', 'Synthetic examples · All free'));
    const layout = node('div', 'storefront');
    const list = node('div', 'catalog-list');
    let selectedCard;
    for (const entry of entries) {
      const card = node('article', 'listing');
      if (entry.id === selectedId) card.dataset.selected = '';
      const control = button('', () => { selectedId = entry.id; renderCatalog(true); }, '', `catalog:entry:${entry.id}`);
      control.setAttribute('aria-label', `View ${entry.title}`);
      control.setAttribute('aria-pressed', String(entry.id === selectedId));
      control.dataset.listing = entry.id;
      const meta = node('div', 'listing-meta');
      meta.append(node('span', '', entry.category), node('strong', '', model.library().includes(entry.id) ? 'In demo library' : 'Free'));
      if (entry.status !== 'published') meta.append(node('span', '', label(entry.status)));
      control.append(icon(entry.icon, entry.tone), node('h2', '', entry.title), node('p', 'byline', entry.creator), node('p', 'summary', entry.summary), meta);
      card.append(control);
      list.append(card);
      if (entry.id === selectedId) selectedCard = card;
    }
    layout.append(list);
    if (entries.length) {
      const selected = detail(entries.find(entry => entry.id === selectedId));
      if (matchMedia('(max-width: 720px)').matches) selectedCard.after(selected);
      else layout.append(selected);
    } else {
      const hasFilter = query || category;
      layout.append(empty(hasFilter ? 'No matching mods' : 'Your demo library is empty', hasFilter ? 'Try another search or category to find a sample mod.' : 'Explore the sample catalog, read the requested permissions, and add a mod here.', hasFilter ? 'Clear filters' : 'Explore mods', () => {
        if (hasFilter) { query = ''; category = ''; render(); }
        else navigate('browse');
      }));
    }
    region.replaceChildren(summary, layout);
    if (focusSelection) region.querySelector(`[data-listing="${selectedId}"]`)?.focus();
  }

  /** Create a labeled native form control and return both the wrapper and input. */
  function field(text, name, value = '', multiline = false, required = true) {
    const wrapper = node('label', multiline ? 'wide' : '', text);
    const input = node(multiline ? 'textarea' : 'input');
    input.name = name;
    input.dataset.focusKey = `${view}:field:${name}`;
    input.value = value;
    input.required = required;
    wrapper.append(input);
    return { wrapper, input };
  }

  /** Show only the current creator's entries; editing published work is unavailable. */
  function renderCreator() {
    const heading = node('div', 'section-heading');
    const copy = node('div');
    copy.append(node('h2', '', 'Creator workspace'), node('p', '', 'Prepare a free mod listing, declare its permissions, and submit it for demo review.'));
    heading.append(copy, button('New submission', () => { editingId = null; render(); }, '', 'creator:new'));
    const desk = node('div', 'desk');
    const own = model.listings().filter(entry => entry.owner === model.actor.id);
    const list = node('ul', 'desk-list');
    for (const entry of own) {
      const row = node('li');
      const control = button(entry.title, () => { editingId = entry.id; render(); }, '', `creator:entry:${entry.id}`);
      control.setAttribute('aria-pressed', String(editingId === entry.id));
      control.append(node('span', '', label(entry.status)));
      row.append(control);
      list.append(row);
    }
    const selected = own.find(entry => entry.id === editingId);
    desk.append(list);
    if (selected && !['draft', 'changes_requested'].includes(selected.status)) {
      const panel = detail(selected, false);
      panel.append(node('p', 'notice', selected.status === 'pending' ? 'This submission is awaiting review. Try the local moderator role to continue.' : 'This entry is read-only. Create a new submission to try the publishing workflow.'));
      desk.append(panel);
    } else desk.append(submissionForm(selected));
    workspace.append(heading, desk);
  }

  /** Build a creator-owned draft editor without accepting files or simulating uploads. */
  function submissionForm(entry) {
    const form = node('form', 'editor');
    form.append(node('h3', '', entry ? `Edit ${entry.title}` : 'New free mod'));
    const grid = node('div', 'form-grid');
    const controls = {};
    for (const [name, text, multiline] of [['title', 'Mod name', false], ['version', 'Version', false], ['category', 'Category', false], ['license', 'License', false], ['summary', 'Short description', true], ['description', 'About this mod', true], ['permissions', 'Requested permissions · one per line', true]]) {
      const value = name === 'permissions' ? entry?.permissions.join('\n') : entry?.[name];
      const { wrapper, input } = field(text, name, value || '', multiline);
      controls[name] = input;
      grid.append(wrapper);
    }
    const actions = node('div', 'form-actions');
    const save = node('button', '', 'Save draft');
    save.type = 'submit';
    save.dataset.focusKey = 'creator:save';
    actions.append(save);
    const submit = node('button', 'primary', 'Submit for demo review');
    submit.type = 'submit';
    submit.name = 'send-review';
    submit.dataset.focusKey = 'creator:submit';
    actions.append(submit);
    form.append(grid, node('p', 'hint', 'Listing text only. No mod files are uploaded. All entries in this proof of concept are free.'), actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const fields = Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.value]));
      fields.permissions = fields.permissions.split('\n').map(value => value.trim()).filter(Boolean);
      const send = event.submitter === submit;
      mutate(() => {
        const saved = model.saveSubmission(fields, Date.now(), entry?.id);
        editingId = saved.id;
        if (send) model.transition(saved.id, 'submit', '', Date.now());
      }, send ? 'Submitted for local demo review. Nothing was published to a server.' : 'Draft saved in this browser.');
    });
    if (entry) {
      const relevant = model.audit().filter(item => item.target === entry.id || String(item.target) === String(entry.id));
      if (relevant.length) form.append(auditLog(relevant));
    }
    return form;
  }

  /** Render eligible review transitions from the shared catalog policy. */
  function renderReview() {
    const heading = node('div', 'section-heading');
    const copy = node('div');
    copy.append(node('h2', '', 'Review queue'), node('p', '', 'Review declarations and record a reason. You cannot review your own submissions.'));
    heading.append(copy);
    workspace.append(heading);
    const entries = model.listings().filter(entry => model.transitions(entry.id).length > 0)
      .sort((left, right) => Number(right.status === 'pending') - Number(left.status === 'pending'));
    if (!entries.some(entry => entry.id === reviewId)) reviewId = entries[0]?.id ?? null;
    if (!entries.length) {
      workspace.append(empty('No entries to review', 'Use the local creator role to save and submit a listing, then return here as a moderator.'));
      return;
    }
    const desk = node('div', 'desk');
    const list = node('ul', 'desk-list');
    for (const entry of entries) {
      const row = node('li');
      const control = button(entry.title, () => { reviewId = entry.id; render(); }, '', `review:entry:${entry.id}`);
      control.setAttribute('aria-pressed', String(reviewId === entry.id));
      control.append(node('span', '', `${label(entry.status)} · ${entry.creator}`));
      row.append(control);
      list.append(row);
    }
    const entry = entries.find(item => item.id === reviewId);
    const panel = node('section', 'review-panel');
    panel.append(detail(entry, false));
    const rules = model.transitions(entry.id);
    const form = node('form');
    const reason = field('Review reason', 'reason', '', true, rules[0]?.requires_reason ?? false);
    const actions = node('div', 'form-actions');
    for (const rule of rules) {
      const control = node('button', rule.action === 'approve' ? 'primary' : '', label(rule.action));
      control.type = 'submit';
      control.value = rule.action;
      control.dataset.focusKey = `review:action:${entry.id}:${rule.action}`;
      control.addEventListener('click', () => { reason.input.required = rule.requires_reason; });
      actions.append(control);
    }
    form.append(reason.wrapper, node('p', 'hint', 'Your decision and reason are recorded in the local demo audit.'), actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const action = event.submitter.value;
      mutate(() => model.transition(entry.id, action, reason.input.value, Date.now()), `${label(action)} recorded for ${entry.title} in this browser.`);
    });
    panel.append(form);
    desk.append(list, panel);
    workspace.append(desk);
  }

  /** Present staff simulation and audit; the role switch remains separate from grants. */
  function renderStaff() {
    const heading = node('div', 'section-heading');
    const copy = node('div');
    copy.append(node('h2', '', 'Demo staff & audit'), node('p', '', 'Assign or remove simulated staff roles and record the reason for each change.'));
    heading.append(copy);
    workspace.append(heading, node('p', 'notice', 'These records are local examples, not real access control. Demo role switching remains available to everyone.'));
    const layout = node('div', 'staff-layout');
    const form = node('form', 'editor');
    form.append(node('h3', '', 'Change a demo staff role'));
    const grid = node('div', 'form-grid');
    const account = field('Demo account ID', 'account', '', false);
    account.wrapper.classList.add('wide');
    account.input.placeholder = 'e.g. reviewer-example';
    const roleLabel = node('label', 'wide', 'Assignment');
    const role = node('select');
    role.dataset.focusKey = 'staff:field:assignment';
    for (const value of model.roles.filter(value => model.can('staff.manage') && (modelRoleCan(value, 'submission.review') || modelRoleCan(value, 'staff.manage')))) {
      const option = node('option', '', `${label(value)} (demo)`);
      option.value = value;
      role.append(option);
    }
    const remove = node('option', '', 'Remove staff assignment');
    remove.value = '';
    role.append(remove);
    roleLabel.append(role);
    const reason = field('Reason', 'reason', '', true);
    grid.append(account.wrapper, roleLabel, reason.wrapper);
    const actions = node('div', 'form-actions');
    const submit = node('button', 'primary', 'Save demo assignment');
    submit.type = 'submit';
    submit.dataset.focusKey = 'staff:save';
    actions.append(submit);
    form.append(grid, actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      mutate(() => model.manageStaff(account.input.value, role.value || null, reason.input.value, Date.now()), 'Demo staff assignment updated. No real account permissions changed.');
    });
    const staff = node('div');
    staff.append(node('h3', '', 'Local staff assignments'));
    const rows = node('div', 'staff-list');
    for (const member of model.staff()) {
      const row = node('div', 'staff-row');
      const name = node('div', '', member.id);
      name.append(node('span', '', `${label(member.role)} · simulated`));
      row.append(name, button('Edit assignment', () => { account.input.value = member.id; role.value = member.role; reason.input.focus(); }, '', `staff:edit:${member.id}`));
      rows.append(row);
    }
    if (!model.staff().length) rows.append(node('p', 'muted small', 'No local assignments yet. Add a demo account to try the workflow.'));
    staff.append(rows);
    layout.append(form, staff);
    workspace.append(layout, auditLog(model.audit()));
  }

  let catalog;
  /** Read capabilities from the shared fixture for assignment options. */
  function modelRoleCan(role, permission) {
    return Object.hasOwn(catalog.roles, role) && catalog.roles[role].includes(permission);
  }

  /** Show the reason and actor for every local workflow decision. */
  function auditLog(entries) {
    const section = node('section', 'audit');
    section.append(node('h3', '', 'Local demo audit'));
    if (!entries.length) section.append(node('p', 'muted small', 'No changes recorded yet. Decisions and reasons will appear here.'));
    const list = node('ol');
    for (const item of [...entries].reverse()) {
      const row = node('li');
      row.append(node('strong', '', `${label(item.action)} · ${item.target}`));
      row.append(node('p', '', `By ${item.actorId}${item.reason ? ` · ${item.reason}` : ''}`));
      const previous = item.previousStatus ?? item.previousRole;
      const next = item.newStatus ?? item.newRole;
      if (previous !== null || next !== null) row.append(node('p', '', `${previous ?? 'None'} → ${next ?? 'None'}`));
      const time = node('time', '', new Date(item.at).toLocaleString());
      if (Number.isFinite(new Date(item.at).getTime())) time.dateTime = new Date(item.at).toISOString();
      row.append(time);
      list.append(row);
    }
    section.append(list);
    return section;
  }

  /** Explain the actual sign-in prerequisites without starting a pretend OAuth flow. */
  function renderSignIn() {
    const section = node('section', 'signin');
    section.append(node('h2', '', 'Microsoft sign-in setup'), node('p', '', 'Real sign-in is not available in this proof of concept. No Microsoft account is connected, and this page does not request credentials.'));
    const steps = node('ol');
    for (const text of ['Register the production application and its exact return URLs with Microsoft.', 'Connect an authoritative backend for secure sessions, verified Xbox access where required, and account permissions.', 'Implement and validate account linking, consent, sign-out, and recovery before enabling sign-in.']) steps.append(node('li', '', text));
    const disabled = button('Microsoft sign-in unavailable', () => {}, 'primary');
    disabled.disabled = true;
    section.append(steps, disabled, node('p', 'hint', 'You can explore with local demo roles. Switching roles does not authenticate you.'));
    workspace.append(section);
  }

  document.getElementById('demo-toggle').addEventListener('click', event => {
    const panel = document.getElementById('demo-controls');
    panel.hidden = !panel.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.getElementById('signin-link').addEventListener('click', () => { if (model) navigate('signin'); });
  roleSelect.addEventListener('change', () => mutate(() => model.setRole(roleSelect.value), `Local ${label(roleSelect.value)} role selected. No real permissions changed.`));
  document.getElementById('reset-demo').addEventListener('click', () => {
    model = window.CinnabarMarketplace.createModel(catalog);
    selectedId = editingId = reviewId = null;
    view = 'browse';
    query = category = '';
    persist();
    render();
    announce('Local demo reset. The sample catalog has been restored.');
  });
  matchMedia('(max-width: 720px)').addEventListener('change', () => { if (model && ['browse', 'library'].includes(view)) renderCatalog(); });

  /** Load the generated shared fixture, with an honest recoverable failure state. */
  async function start() {
    try {
      const response = await fetch('/marketplace/catalog.json');
      if (!response.ok) throw new Error('Catalog request failed.');
      catalog = await response.json();
      let saved;
      try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); }
      catch { storageAvailable = false; }
      model = window.CinnabarMarketplace.createModel(catalog, saved);
      for (const role of model.roles) {
        const option = node('option', '', label(role));
        option.value = role;
        roleSelect.append(option);
      }
      render();
      if (!storageAvailable) announce('Browser storage is unavailable. You can still try the demo for this page session.');
    } catch {
      workspace.replaceChildren(empty('The sample catalog could not load', 'Reload the page to try again. No account or library data was sent.', 'Reload page', () => location.reload()));
      document.getElementById('demo-toggle').disabled = true;
    }
  }

  start();
})();
