/* Browser-local marketplace demonstration. No account or artifact requests. */
(function () {
  'use strict';

  const storageKey = 'cinnabar.marketplace.demo.v1';
  const workspace = document.getElementById('workspace');
  const feedback = document.getElementById('feedback');
  let model;
  let view = 'browse';
  let selectedId = null;
  let editingId = null;
  let reviewId = null;
  let query = '';
  let category = '';
  let storageAvailable = true;
  let accountSwitchOpen = false;
  let preferencesOpen = false;

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
    const sections = [['browse', 'Explore'], ['library', `My library (${model.library().length})`]];
    if (model.can('submission.create')) sections.push(['creator', 'Creator workspace']);
    if (model.can('submission.review')) sections.push(['review', 'Review queue']);
    if (model.can('staff.manage')) sections.push(['staff', 'Staff & audit']);
    if (view !== 'account' && !sections.some(([id]) => id === view)) view = 'browse';
    document.getElementById('workspace-nav').replaceChildren(...sections.map(([id, text]) => {
      const control = button(text, () => navigate(id), '', `nav:${id}`);
      if (id === view) control.setAttribute('aria-current', 'page');
      return control;
    }));
    const actor = model.actor;
    document.getElementById('account-name').textContent = actor.name;
    document.getElementById('account-role').textContent = label(actor.role);
    document.getElementById('account-avatar').textContent = initials(actor.name);
    document.getElementById('account-link').disabled = false;
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
    else renderAccount();
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
    permissions.append(list);
    result.append(metadata, permissions);
    if (libraryAction) {
      const added = model.library().includes(entry.id);
      if (entry.status !== 'published') result.append(node('p', 'notice', `${label(entry.status)} · This mod is unavailable. You can remove its saved selection from your library.`));
      const control = button(added ? 'Remove from library' : 'Add to library', () => {
        mutate(() => model.toggleLibrary(entry.id, Date.now()), added ? `${entry.title} removed from your library.` : `${entry.title} added to your library.`);
        const replacement = workspace.querySelector('.detail button') || workspace.querySelector('[data-focus-key="catalog:recovery"]');
        if (replacement) replacement.focus();
      }, added ? '' : 'primary', `catalog:library:${entry.id}`);
      result.append(control, node('p', 'hint', 'Adding to your library does not install a mod or grant its requested permissions.'));
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
    const focused = document.activeElement;
    const entries = view === 'library' ? model.libraryEntries(query, category) : model.search(query, category);
    if (!entries.some(entry => entry.id === selectedId)) selectedId = entries[0]?.id ?? null;
    const summary = node('div', 'results-label');
    summary.append(node('span', '', `${entries.length} ${entries.length === 1 ? 'mod' : 'mods'}${view === 'library' ? ' in your library' : ' to explore'}`), node('span', '', 'All mods are free'));
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
      meta.append(node('span', '', entry.category), node('strong', '', model.library().includes(entry.id) ? 'In library' : 'Free'));
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
      layout.append(empty(hasFilter ? 'No matching mods' : 'Your library is empty', hasFilter ? 'Try another search or category.' : 'Find a mod you like and add it to your library.', hasFilter ? 'Clear filters' : 'Explore mods', () => {
        if (hasFilter) { query = ''; category = ''; render(); }
        else navigate('browse');
      }));
    }
    region.replaceChildren(summary, layout);
    if (focusSelection) region.querySelector(`[data-listing="${selectedId}"]`)?.focus();
    else restoreFocus(focused);
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
    copy.append(node('h2', '', 'Creator workspace'), node('p', '', 'Prepare a free mod listing, declare its permissions, and submit it for review.'));
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
      panel.append(node('p', 'notice', selected.status === 'pending' ? 'Your submission is awaiting review.' : 'This listing is read-only. Create a new submission to share another mod.'));
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
    const submit = node('button', 'primary', 'Submit for review');
    submit.type = 'submit';
    submit.name = 'send-review';
    submit.dataset.focusKey = 'creator:submit';
    actions.append(submit);
    form.append(grid, actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const fields = Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.value]));
      fields.permissions = fields.permissions.split('\n').map(value => value.trim()).filter(Boolean);
      const send = event.submitter === submit;
      mutate(() => {
        const saved = model.saveSubmission(fields, Date.now(), entry?.id);
        editingId = saved.id;
        if (send) model.transition(saved.id, 'submit', '', Date.now());
      }, send ? 'Submitted for review.' : 'Draft saved.');
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
      workspace.append(empty('No entries to review', 'New submissions will appear here when they are ready for review.'));
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
    form.append(reason.wrapper, node('p', 'hint', 'Your decision and reason will appear in the audit log.'), actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const action = event.submitter.value;
      mutate(() => model.transition(entry.id, action, reason.input.value, Date.now()), `${label(action)} recorded for ${entry.title}.`);
    });
    panel.append(form);
    desk.append(list, panel);
    workspace.append(desk);
  }

  /** Present staff simulation and audit; the role switch remains separate from grants. */
  function renderStaff() {
    const heading = node('div', 'section-heading');
    const copy = node('div');
    copy.append(node('h2', '', 'Staff & audit'), node('p', '', 'Manage staff assignments and review account activity.'));
    heading.append(copy);
    workspace.append(heading);
    const layout = node('div', 'staff-layout');
    const form = node('form', 'editor');
    form.append(node('h3', '', 'Change a staff assignment'));
    const grid = node('div', 'form-grid');
    const account = field('Account ID', 'account', '', false);
    account.wrapper.classList.add('wide');
    account.input.placeholder = 'Gamertag or account ID';
    const roleLabel = node('label', 'wide', 'Assignment');
    const role = node('select');
    role.dataset.focusKey = 'staff:field:assignment';
    for (const value of model.roles.filter(value => model.can('staff.manage') && (modelRoleCan(value, 'submission.review') || modelRoleCan(value, 'staff.manage')))) {
      const option = node('option', '', label(value));
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
    const submit = node('button', 'primary', 'Save assignment');
    submit.type = 'submit';
    submit.dataset.focusKey = 'staff:save';
    actions.append(submit);
    form.append(grid, actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      mutate(() => model.manageStaff(accountId(account.input.value), role.value || null, reason.input.value, Date.now()), 'Staff assignment saved.');
    });
    const staff = node('div');
    staff.append(node('h3', '', 'Staff members'));
    const rows = node('div', 'staff-list');
    for (const member of model.staff()) {
      const row = node('div', 'staff-row');
      const name = node('div', '', accountName(member.id));
      name.append(node('span', '', label(member.role)));
      row.append(name, button('Edit assignment', () => { account.input.value = model.account(member.id)?.gamertag || member.id; role.value = member.role; reason.input.focus(); }, '', `staff:edit:${member.id}`));
      rows.append(row);
    }
    if (!model.staff().length) rows.append(node('p', 'muted small', 'No staff assigned. Enter an account ID to add a staff member.'));
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
  function auditLog(entries, title = 'Audit log', emptyMessage = 'No changes recorded yet. Decisions and reasons will appear here.') {
    const section = node('section', 'audit');
    section.append(node('h3', '', title));
    if (!entries.length) section.append(node('p', 'muted small', emptyMessage));
    const list = node('ol');
    for (const item of [...entries].reverse()) {
      const row = node('li');
      row.append(node('strong', '', `${label(item.action.replaceAll('.', ' '))} · ${accountName(item.target)}`));
      row.append(node('p', '', `By ${accountName(item.actorId)}${item.reason ? ` · ${item.reason}` : ''}`));
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

  /** Resolve known profiles and listings without exposing internal account identifiers. */
  function accountName(id) {
    return model.account(id)?.name || model.listings().find(entry => entry.id === id)?.title || String(id);
  }

  /** Resolve a known gamertag or profile name to its stable account identifier. */
  function accountId(value) {
    const normalized = value.trim().toLowerCase();
    return model.accounts().find(account => [account.id, account.name, account.gamertag]
      .some(name => name?.toLowerCase() === normalized))?.id || value;
  }

  /** Derive a compact avatar from the shared profile name. */
  function initials(name) {
    return name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  }

  /** Show the signed-in profile with secondary account switching and preferences. */
  function renderAccount() {
    const actor = model.actor;
    const section = node('section', 'account-page');
    const heading = node('div', 'section-heading');
    heading.append(node('h2', '', 'Account'));
    const layout = node('div', 'account-layout');
    const profile = node('section', 'profile');
    const identity = node('div', 'profile-identity');
    const avatar = node('span', 'avatar profile-avatar', initials(actor.name));
    avatar.setAttribute('aria-hidden', 'true');
    const name = node('div');
    name.append(node('h3', '', actor.name), node('p', 'muted', label(actor.role)));
    identity.append(avatar, name);
    const metadata = node('dl', 'profile-metadata');
    for (const [term, value] of [['Gamertag', actor.gamertag || actor.name], ['Account provider', 'Microsoft']]) {
      const group = node('div');
      group.append(node('dt', '', term), node('dd', '', value));
      metadata.append(group);
    }
    profile.append(identity, metadata, button('View my library', () => navigate('library'), '', 'account:library'));
    const preferences = node('div', 'account-preferences');
    const switching = node('details', 'account-switcher');
    switching.open = accountSwitchOpen;
    switching.addEventListener('toggle', () => { accountSwitchOpen = switching.open; });
    switching.append(node('summary', '', 'Switch account'));
    const choices = node('div', 'account-choices');
    for (const account of model.accounts()) {
      const control = button('', () => {
        accountSwitchOpen = true;
        selectedId = editingId = reviewId = null;
        mutate(() => model.setAccount(account.id), `Switched to ${account.name}.`);
      }, 'account-choice', `account:switch:${account.id}`);
      control.setAttribute('aria-pressed', String(account.id === actor.id));
      const avatar = node('span', 'avatar', initials(account.name));
      avatar.setAttribute('aria-hidden', 'true');
      const description = node('span', 'account-summary');
      description.append(node('strong', '', account.name), node('span', '', label(account.role)));
      control.append(avatar, description);
      choices.append(control);
    }
    switching.append(choices);
    const reset = node('details', 'account-reset');
    reset.open = preferencesOpen;
    reset.addEventListener('toggle', () => { preferencesOpen = reset.open; });
    reset.append(node('summary', '', 'Preferences'), node('p', 'hint', 'Clear your saved library, submissions, and activity to start over.'));
    reset.append(button('Reset saved data', () => {
      preferencesOpen = true;
      model = window.CinnabarMarketplace.createModel(catalog);
      selectedId = editingId = reviewId = null;
      query = category = '';
      persist();
      render();
      announce('Saved data reset.');
    }, 'danger', 'account:reset'));
    preferences.append(switching, reset);
    layout.append(profile, preferences);
    section.append(heading, layout, auditLog(model.audit().filter(item => item.actorId === actor.id), 'Activity', 'Your saved mods and submissions will appear here.'));
    workspace.append(section);
  }

  document.getElementById('account-link').addEventListener('click', () => { if (model) navigate('account'); });
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
      render();
      if (!storageAvailable) announce('Your changes cannot be saved on this device. You can continue for this session.');
    } catch {
      workspace.replaceChildren(empty('The catalog could not load', 'Reload the page to try again.', 'Reload page', () => location.reload()));
      document.getElementById('account-link').disabled = true;
    }
  }

  start();
})();
