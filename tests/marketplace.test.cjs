const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {createModel} = require('../marketplace-model.js');
const config = require('../source.json');
const catalogPath = process.env.CINNABAR_MARKETPLACE_CATALOG
  || path.join(__dirname, '../.source', config.inputs.marketplace);
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

/** Copies source inputs before a test varies the catalog policy or listing lifecycle. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Creates original demo submission content without copying a source listing. */
function fields(overrides = {}) {
  return {title: 'Pocket Compass', category: 'Interface', summary: 'A compact heading indicator.',
    description: 'Show a heading in a small movable panel.', version: '0.1.0',
    permissions: ['Read player heading'], ...overrides};
}

/** Creates and submits an owned draft for review workflow tests. */
function pending(model) {
  model.setRole('creator');
  const draft = model.saveSubmission(fields(), 100);
  return model.transition(draft.id, 'submit', '', 101);
}

/** Verifies rejected actions leave every part of mutable state unchanged. */
function rejectsWithoutMutation(model, action, pattern) {
  const before = model.exportState();
  assert.throws(action, pattern);
  assert.deepEqual(model.exportState(), before);
}

/** Freezes nested catalog objects to catch accidental writes to caller-owned inputs. */
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('exports the same pure API to Node and a browser without storage or clocks', () => {
  const browser = {window: {}, Date: {parse: Date.parse, now() { throw new Error('Ambient time is unavailable'); }}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../marketplace-model.js'), 'utf8'), browser);
  assert.equal(typeof browser.window.CinnabarMarketplace.createModel, 'function');
  const source = freeze(clone(catalog));
  const model = createModel(source);
  const webModel = browser.window.CinnabarMarketplace.createModel(source);
  assert.deepEqual(clone(webModel.listings()), model.listings());
  assert.deepEqual(model.roles, Object.keys(catalog.roles));
  assert.deepEqual(model.actor, {id: 'player-demo', ...catalog.accounts['player-demo']});
  assert.equal(model.state.actorRole, 'player');
  model.listings()[0].permissions.push('Changed outside');
  assert.deepEqual(model.listings(), source.listings);
  assert.equal(model.state.audit.length, 0);
  webModel.setRole('creator');
  const draft = webModel.saveSubmission(fields(), 0);
  assert.equal(webModel.transition(draft.id, 'submit', '', 1).status, 'pending');
});

test('derives permission checks from catalog roles and guards unknown and inherited names', () => {
  const model = createModel(catalog);
  const permissions = new Set(Object.values(catalog.roles).flat());
  for (const role of Object.keys(catalog.roles)) {
    model.setRole(role);
    assert.equal(model.actor.id, role + '-demo');
    for (const permission of permissions) assert.equal(model.can(permission), catalog.roles[role].includes(permission));
    assert.equal(model.can('unknown.permission'), false);
  }
  for (const role of ['superuser', '__proto__', 'constructor', '', null, ['admin']]) {
    rejectsWithoutMutation(model, () => model.setRole(role), /unknown.*role/i);
  }
  model.state.actorRole = 'unknown';
  assert.equal(model.can('staff.manage'), false);
  assert.throws(() => model.actor, /unknown.*role/i);
  rejectsWithoutMutation(model, () => model.manageStaff('helper', 'admin', 'Review help', 5), /unknown.*role/i);
  model.state.actorRole = 'creator';
  assert.equal(model.actor.id, 'creator-demo');
  assert.equal(model.can('submission.create'), true);
  assert.equal(createModel(catalog, {actorRole: 'unknown'}).actor.role, 'player');
});

test('creates stable numeric IDs, trims content and protects identity and lifecycle fields', () => {
  const model = createModel(catalog);
  rejectsWithoutMutation(model, () => model.saveSubmission(fields(), 0), /permission/i);
  model.setRole('creator');
  const draft = model.saveSubmission(fields({title: '  Pocket Compass  ', id: 1, owner: 'admin-demo',
    creator: 'Someone else', status: 'published', permissions: ['Heading', ' Heading '], price: 'Free'}), 0);
  assert.equal(draft.id, Math.max(999, ...catalog.listings.map(entry => entry.id)) + 1);
  assert.equal(draft.owner, 'creator-demo');
  assert.equal(draft.creator, model.actor.name);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.title, 'Pocket Compass');
  assert.deepEqual(draft.permissions, ['Heading']);
  assert.equal(draft.price, 0);
  const edited = model.saveSubmission(fields({title: 'Revised compass', owner: 'other', id: 5000,
    status: 'published'}), 1, draft.id);
  assert.equal(edited.id, draft.id);
  assert.equal(edited.owner, draft.owner);
  assert.equal(edited.status, 'draft');
  assert.equal(edited.createdAt, 0);
  assert.equal(edited.updatedAt, 1);
  const restored = createModel(catalog, JSON.stringify(model.exportState()));
  const next = restored.saveSubmission(fields(), 2);
  assert.equal(next.id, draft.id + 1);
  const higherCatalog = clone(catalog);
  higherCatalog.listings[0].id = 7000;
  const withHigherSource = createModel(higherCatalog, restored.exportState());
  assert.equal(withHigherSource.saveSubmission(fields(), 3).id, 7001);
});

test('validates required content, requested permissions, free pricing and unsupported delivery fields atomically', () => {
  const model = createModel(catalog);
  model.setRole('creator');
  const bad = [null, [], ...['title', 'category', 'summary', 'description', 'version'].flatMap(key => [
    fields({[key]: ''}), fields({[key]: ' \n '}), fields({[key]: 7})]),
  ...[undefined, null, 'Heading', [], [''], ['Heading', 7]].map(permissions => fields({permissions})),
  ...[3, '1.99', false, -1, null].map(price => fields({price})),
  fields({artifact: 'local.zip'}), fields({upload: {name: 'demo.zip'}}), fields({downloadUrl: 'https://example.invalid'}),
  fields({description: 'See https://example.invalid for the download.'}),
  fields({summary: 'Read more at example.invalid/docs'}), fields({permissions: ['www.example.invalid']})];
  for (const value of bad) rejectsWithoutMutation(model, () => model.saveSubmission(value, 10), /required|permissions|free|unsupported|links|object/i);
  for (const now of [undefined, null, -1, NaN, Infinity, {}, 'yesterday']) {
    rejectsWithoutMutation(model, () => model.saveSubmission(fields(), now), /timestamp/i);
  }
  const at = '2026-10-22T18:45:00.000Z';
  const draft = model.saveSubmission(fields(), at);
  assert.equal(draft.updatedAt, at);
  assert.equal(model.audit()[0].at, at);
});

test('runs revisions, resubmission, approval and suspension with complete deterministic audit records', () => {
  const model = createModel(catalog);
  const entry = pending(model);
  assert.equal(entry.status, 'pending');
  rejectsWithoutMutation(model, () => model.saveSubmission(fields(), 102, entry.id), /draft|changes_requested/i);
  model.setRole('moderator');
  assert.ok(model.transitions(entry.id).some(rule => rule.action === 'request_changes'));
  assert.equal(model.transition(entry.id, 'request_changes', '  Explain requested permissions.  ', 102).status, 'changes_requested');
  model.setRole('creator');
  const revision = model.saveSubmission(fields({description: 'Read heading only to draw the compass.'}), 103, entry.id);
  assert.equal(revision.status, 'changes_requested');
  model.transition(entry.id, 'submit', undefined, 104);
  model.setRole('moderator');
  const published = model.transition(entry.id, 'approve', 'Permissions are explained.', 105);
  assert.equal(published.status, 'published');
  assert.ok(model.search('compass', 'Interface').some(candidate => candidate.id === entry.id));
  const suspended = model.transition(entry.id, 'suspend', 'Listing needs another review.', 106);
  assert.equal(suspended.status, 'suspended');
  assert.equal(model.search('compass').some(candidate => candidate.id === entry.id), false);
  const history = model.audit();
  assert.deepEqual(history.map(event => event.at), [100, 101, 102, 103, 104, 105, 106]);
  assert.deepEqual(history.find(event => event.action === 'approve'), {
    at: 105, actorId: 'moderator-demo', actorRole: 'moderator', action: 'approve', target: entry.id,
    reason: 'Permissions are explained.', previousStatus: 'pending', newStatus: 'published', previousRole: null, newRole: null
  });
  assert.equal(history.find(event => event.action === 'request_changes').reason, 'Explain requested permissions.');
  history[0].reason = 'Changed outside';
  assert.equal(model.audit()[0].reason, '');
});

test('allows only catalog rules and rejects missing reasons without partial status or audit changes', () => {
  const model = createModel(catalog);
  const entry = pending(model);
  model.setRole('moderator');
  const allowed = model.transitions(entry.id);
  const expected = catalog.review_transitions.filter(rule => rule.from === entry.status
    && catalog.roles.moderator.includes(rule.permission) && rule.owner === 'other');
  assert.deepEqual(allowed, expected);
  for (const rule of allowed.filter(rule => rule.requires_reason)) {
    for (const reason of [undefined, null, '', ' \n ', 1]) {
      rejectsWithoutMutation(model, () => model.transition(entry.id, rule.action, reason, 200), /reason/i);
    }
  }
  rejectsWithoutMutation(model, () => model.transition(entry.id, 'publish-directly', 'No rule', 200), /not permitted/i);
  rejectsWithoutMutation(model, () => model.transition(entry.id, 'approve', 'Fine', undefined), /timestamp/i);
  model.setRole('player');
  assert.deepEqual(model.transitions(entry.id), []);
  rejectsWithoutMutation(model, () => model.transition(entry.id, 'approve', 'Fine', 200), /not permitted/i);
});

test('requires_reason follows catalog policy even for renamed actions and validates its boolean schema', () => {
  const changed = clone(catalog);
  const submit = changed.review_transitions.find(rule => rule.from === 'draft');
  submit.action = 'send_for_inspection';
  submit.requires_reason = true;
  const approve = changed.review_transitions.find(rule => rule.action === 'approve');
  approve.requires_reason = false;
  const model = createModel(changed);
  model.setRole('creator');
  const draft = model.saveSubmission(fields(), 1);
  rejectsWithoutMutation(model, () => model.transition(draft.id, submit.action, '', 2), /reason/i);
  model.transition(draft.id, submit.action, 'Ready for inspection.', 2);
  model.setRole('moderator');
  assert.equal(model.transition(draft.id, 'approve', '', 3).status, approve.to);
  for (const invalid of [undefined, null, 1, 'true']) {
    const broken = clone(catalog);
    broken.review_transitions[0].requires_reason = invalid;
    assert.throws(() => createModel(broken), /requires_reason.*boolean/i);
  }
});

test('enforces owner exclusions even when an owner role has review and suspension permissions', () => {
  const changed = clone(catalog);
  for (const rule of changed.review_transitions.filter(rule => rule.owner === 'other')) {
    if (!changed.roles.creator.includes(rule.permission)) changed.roles.creator.push(rule.permission);
  }
  const model = createModel(changed);
  const entry = pending(model);
  assert.equal(model.can('submission.review'), true);
  assert.deepEqual(model.transitions(entry.id), []);
  rejectsWithoutMutation(model, () => model.transition(entry.id, 'approve', 'Self review', 200), /not permitted/i);
  model.setRole('moderator');
  model.transition(entry.id, 'approve', 'Independent review', 201);
  model.setRole('creator');
  assert.deepEqual(model.transitions(entry.id), []);
  rejectsWithoutMutation(model, () => model.transition(entry.id, 'suspend', 'Self suspension', 202), /not permitted/i);
});

test('forbids editing another owner and published entries and applies sparse edits to source drafts', () => {
  const changed = clone(catalog);
  const own = changed.listings.find(entry => entry.owner === 'creator-demo');
  own.status = 'draft';
  const other = changed.listings.find(entry => entry.owner !== 'creator-demo');
  other.status = 'changes_requested';
  const model = createModel(changed);
  model.setRole('creator');
  rejectsWithoutMutation(model, () => model.saveSubmission(fields(), 1, other.id), /own/i);
  const edited = model.saveSubmission({...own, title: 'A new title'}, 2, own.id);
  assert.equal(edited.owner, own.owner);
  assert.equal(edited.id, own.id);
  assert.equal(edited.status, 'draft');
  assert.equal(model.state.submissions.length, 0);
  assert.deepEqual(model.exportState().listingEdits[own.id].fields, {title: 'A new title'});
  const updatedSource = clone(changed);
  updatedSource.listings.find(entry => entry.id === own.id).description = 'An updated source description.';
  const restored = createModel(updatedSource, model.exportState());
  assert.equal(restored.listings().find(entry => entry.id === own.id).description, 'An updated source description.');
  assert.equal(restored.listings().find(entry => entry.id === own.id).title, 'A new title');
  model.transition(own.id, 'submit', '', 3);
  model.setRole('moderator');
  model.transition(own.id, 'approve', 'Reviewed', 4);
  model.setRole('creator');
  rejectsWithoutMutation(model, () => model.saveSubmission(fields(), 5, own.id), /draft|changes_requested/i);
});

test('keeps libraries per identity and searches only published entries by text and category', () => {
  const model = createModel(catalog);
  const published = catalog.listings.filter(entry => entry.status === 'published');
  const entry = published[0];
  const unpublished = catalog.listings.find(candidate => candidate.status !== 'published');
  assert.deepEqual(model.search('', ''), published);
  assert.deepEqual(model.library(), []);
  assert.deepEqual(model.toggleLibrary(entry.id, 1), [entry.id]);
  assert.deepEqual(model.search(entry.title.toUpperCase(), entry.category, true).map(candidate => candidate.id), [entry.id]);
  assert.deepEqual(model.search('no such listing', '', true), []);
  assert.deepEqual(model.search('', 'no such category', true), []);
  assert.deepEqual(model.search('', 'all', true).map(candidate => candidate.id), [entry.id]);
  assert.ok(model.search(entry.creator.toLowerCase()).some(candidate => candidate.id === entry.id));
  rejectsWithoutMutation(model, () => model.toggleLibrary(unpublished.id, 2), /published/i);
  rejectsWithoutMutation(model, () => model.toggleLibrary('unknown', 2), /unknown.*listing/i);
  model.setRole('creator');
  assert.deepEqual(model.library(), []);
  model.toggleLibrary(published[1].id, 3);
  model.setRole('player');
  assert.deepEqual(model.library(), [entry.id]);
  const detached = model.library();
  detached.push(-1);
  assert.deepEqual(model.library(), [entry.id]);
  model.setRole('moderator');
  model.transition(entry.id, 'suspend', 'Review needed', 4);
  model.setRole('player');
  assert.deepEqual(model.library(), [entry.id]);
  assert.deepEqual(model.search('', '', true), []);
  assert.deepEqual(model.toggleLibrary(entry.id, 5), []);
});

test('grants, changes and removes staff roles with reasons, permission checks and self exclusion', () => {
  const model = createModel(catalog);
  rejectsWithoutMutation(model, () => model.manageStaff('helper', 'moderator', 'Help review', 1), /permission/i);
  model.setRole('admin');
  const initial = model.staff();
  assert.deepEqual(initial.map(member => member.id), Object.entries(catalog.accounts)
    .filter(([, profile]) => catalog.roles[profile.role]?.some(permission => ['submission.review', 'staff.manage'].includes(permission)))
    .map(([id]) => id));
  for (const reason of ['', ' ', undefined, null]) {
    rejectsWithoutMutation(model, () => model.manageStaff('helper', 'moderator', reason, 1), /reason/i);
  }
  for (const role of ['player', 'creator', 'unknown', '__proto__', undefined]) {
    rejectsWithoutMutation(model, () => model.manageStaff('helper', role, 'Help review', 1), /staff role/i);
  }
  rejectsWithoutMutation(model, () => model.manageStaff(' admin-demo ', 'moderator', 'Self', 1), /own/i);
  rejectsWithoutMutation(model, () => model.manageStaff('', 'moderator', 'Help review', 1), /ID/i);
  assert.deepEqual(model.manageStaff(' helper ', 'moderator', '  Help review  ', 2), initial.concat({id: 'helper', role: 'moderator', updatedAt: 2}));
  model.manageStaff('helper', 'admin', 'Manage reviewers', 3);
  rejectsWithoutMutation(model, () => model.manageStaff('helper', null, '', 4), /reason/i);
  assert.deepEqual(model.manageStaff('helper', null, 'Access no longer needed', 4), initial);
  assert.deepEqual(model.audit().map(event => [event.action, event.previousRole, event.newRole, event.at]), [
    ['staff.grant', null, 'moderator', 2], ['staff.grant', 'moderator', 'admin', 3], ['staff.remove', 'admin', null, 4]
  ]);
  assert.equal(model.audit()[2].reason, 'Access no longer needed');
  assert.equal(model.audit()[2].actorId, 'admin-demo');
  rejectsWithoutMutation(model, () => model.manageStaff('helper', null, 'Already removed', 5), /no staff assignment/i);
});

test('derives staff eligibility and action permissions from changed catalog roles', () => {
  const changed = clone(catalog);
  changed.roles.inspector = ['submission.review'];
  changed.roles.coordinator = ['staff.manage'];
  changed.roles.creator.push('staff.manage');
  const model = createModel(changed);
  model.setRole('creator');
  model.manageStaff('review-helper', 'inspector', 'Review support', 1);
  model.manageStaff('staff-helper', 'coordinator', 'Staff support', 2);
  assert.deepEqual(model.staff().filter(member => member.id.endsWith('-helper')).map(member => member.role), ['inspector', 'coordinator']);
  const entry = pending(model);
  model.setRole('inspector');
  assert.equal(model.transition(entry.id, 'approve', 'Inspected', 102).status, 'published');
});

test('round-trips mutable state while deriving unchanged content and policy from the latest catalog', () => {
  const model = createModel(catalog);
  const published = catalog.listings.find(entry => entry.status === 'published');
  model.toggleLibrary(published.id, 1);
  const entry = pending(model);
  model.setRole('moderator');
  model.transition(entry.id, 'approve', 'Reviewed', 102);
  model.setRole('admin');
  model.manageStaff('helper', 'moderator', 'Help review', 103);
  const exported = model.exportState();
  const restored = createModel(catalog, JSON.stringify(exported));
  assert.deepEqual(restored.exportState(), exported);
  assert.deepEqual(restored.listings(), model.listings());
  assert.equal(Object.hasOwn(exported, 'listings'), false);
  assert.equal(Object.hasOwn(exported, 'roles'), false);
  assert.equal(Object.hasOwn(exported, 'review_transitions'), false);
  assert.deepEqual(exported.listingEdits, {});
  exported.actorRole = 'player';
  exported.audit[0].reason = 'Outside mutation';
  assert.equal(model.actor.role, 'admin');
  assert.equal(model.audit()[0].reason, '');
  const updated = clone(catalog);
  updated.listings.find(candidate => candidate.id === published.id).title = 'Updated source title';
  updated.roles.admin = updated.roles.admin.filter(permission => permission !== 'staff.manage');
  const refreshed = createModel(updated, model.exportState());
  assert.equal(refreshed.listings().find(candidate => candidate.id === published.id).title, 'Updated source title');
  assert.equal(refreshed.can('staff.manage'), false);
  rejectsWithoutMutation(refreshed, () => refreshed.manageStaff('another', 'moderator', 'More help', 104), /permission/i);
});

test('restores source status deltas without resurrecting removed entries or retaining removed transition rules', () => {
  const model = createModel(catalog);
  const published = catalog.listings.find(entry => entry.status === 'published');
  model.setRole('moderator');
  model.transition(published.id, 'suspend', 'Recheck the listing', 1);
  const queued = pending(model);
  const saved = model.exportState();
  const restored = createModel(catalog, saved);
  assert.equal(restored.listings().find(entry => entry.id === published.id).status, 'suspended');
  assert.deepEqual(restored.exportState(), saved);
  const updated = clone(catalog);
  updated.listings = updated.listings.filter(entry => entry.id !== published.id);
  updated.review_transitions = updated.review_transitions.filter(rule => rule.action !== 'approve');
  const refreshed = createModel(updated, saved);
  assert.equal(refreshed.listings().some(entry => entry.id === published.id), false);
  assert.equal(Object.hasOwn(refreshed.exportState().listingEdits, published.id), false);
  refreshed.setRole('moderator');
  assert.equal(refreshed.transitions(queued.id).some(rule => rule.action === 'approve'), false);
  rejectsWithoutMutation(refreshed, () => refreshed.transition(queued.id, 'approve', 'Old rule', 3), /not permitted/i);
});

test('discards restored draft collisions and refuses unsafe numeric successors before mutation', () => {
  const model = createModel(catalog);
  model.setRole('creator');
  const draft = model.saveSubmission(fields(), 0);
  const updated = clone(catalog);
  const newSource = {...clone(catalog.listings[0]), id: draft.id, title: 'New source listing'};
  updated.listings.push(newSource);
  const restored = createModel(updated, model.exportState());
  assert.deepEqual(restored.listings().find(entry => entry.id === draft.id), newSource);
  assert.equal(restored.state.submissions.length, 0);
  assert.equal(restored.saveSubmission(fields(), 1).id, draft.id + 1);
  const exhaustedCatalog = clone(catalog);
  exhaustedCatalog.listings[0].id = Number.MAX_SAFE_INTEGER;
  const exhausted = createModel(exhaustedCatalog);
  exhausted.setRole('creator');
  rejectsWithoutMutation(exhausted, () => exhausted.saveSubmission(fields(), 0), /numeric listing ID/i);
});

test('keeps existing submissions and audit history when capabilities or historical roles are removed', () => {
  const model = createModel(catalog);
  const draft = pending(model);
  model.setRole('moderator');
  model.transition(draft.id, 'approve', 'Independent review', 2);
  model.setRole('creator');
  const saved = model.exportState();
  const revoked = clone(catalog);
  revoked.roles.creator = revoked.roles.creator.filter(permission => permission !== 'submission.create');
  const withoutCreation = createModel(revoked, saved);
  assert.equal(withoutCreation.listings().find(entry => entry.id === draft.id).status, 'published');
  assert.deepEqual(withoutCreation.audit(), model.audit());
  rejectsWithoutMutation(withoutCreation, () => withoutCreation.saveSubmission(fields(), 3), /permission/i);
  const removed = clone(revoked);
  delete removed.roles.moderator;
  delete removed.roles.creator;
  const withoutRoles = createModel(removed, saved);
  assert.equal(withoutRoles.actor.role, 'player');
  assert.equal(withoutRoles.listings().find(entry => entry.id === draft.id).owner, 'creator-demo');
  assert.deepEqual(withoutRoles.audit(), model.audit());
  assert.equal(withoutRoles.can('submission.create'), false);
});

test('rejects sparse requested permission arrays before creating unreloadable submissions', () => {
  const model = createModel(catalog);
  model.setRole('creator');
  const permissions = ['Read player heading'];
  permissions.length = 2;
  rejectsWithoutMutation(model, () => model.saveSubmission(fields({permissions}), 0), /permission.*required/i);
});

test('safely restores malformed state, filters damaged records and ignores catalog or identity injection', () => {
  const baseline = createModel(catalog).exportState();
  const cycle = {}; cycle.self = cycle;
  for (const saved of [null, [], false, 7, 'broken JSON', '{', cycle, {schemaVersion: 999},
    {actorRole: '__proto__', submissions: {}, listingEdits: [], libraries: [], staff: {}, audit: {}}]) {
    assert.deepEqual(createModel(catalog, saved).exportState(), baseline);
  }
  const model = createModel(catalog);
  model.setRole('creator');
  const draft = model.saveSubmission(fields(), 1);
  const saved = model.exportState();
  saved.submissions.push({...draft, id: draft.id + 1, permissions: ['']}, {...draft, id: draft.id + 2, owner: null}, clone(saved.submissions[0]));
  const source = catalog.listings[0];
  saved.listingEdits[source.id] = {owner: 'attacker', id: 9000, status: 'invented', fields: {title: null}};
  saved.listingEdits[999999] = {status: 'published'};
  saved.libraries = {'creator-demo': [draft.id, draft.id, source.id, -1, String(source.id), {}], 'unknown-demo': [source.id]};
  saved.staff = [{id: 'bad', role: 'unknown', updatedAt: 1}, {id: 'helper', role: 'moderator', updatedAt: 2}];
  saved.audit.push(null, {at: 1, actorRole: 'admin', actorId: 'attacker', action: 'approve'});
  saved.roles = {creator: ['staff.manage']};
  saved.listings = [{id: 8888, status: 'published'}];
  const restored = createModel(catalog, saved);
  assert.equal(restored.listings().filter(entry => entry.id >= 1000).length, 1);
  assert.deepEqual(restored.listings().find(entry => entry.id === source.id), source);
  assert.deepEqual(restored.library(), [draft.id, source.id]);
  assert.deepEqual(restored.staff(), [{id: 'helper', role: 'moderator', updatedAt: 2}]);
  assert.equal(restored.audit().length, 1);
  assert.equal(restored.can('staff.manage'), false);
  assert.equal(restored.listings().some(entry => entry.id === 8888), false);
});


test('shared account selection isolates same-role ownership and libraries and restores legacy roles', () => {
  const model = createModel(catalog);
  const creators = model.accounts().filter(account => account.role === 'creator');
  assert.ok(creators.length > 1);
  const entry = catalog.listings.find(entry => entry.status === 'published');
  const [first, second] = creators;
  model.setAccount(first.id);
  model.toggleLibrary(entry.id, 1);
  const draft = model.saveSubmission(fields(), 2);
  model.setAccount(second.id);
  assert.equal(model.actor.name, second.name);
  assert.deepEqual(model.library(), []);
  rejectsWithoutMutation(model, () => model.saveSubmission(fields(), 3, draft.id), /own/i);
  model.toggleLibrary(entry.id, 4);
  const restored = createModel(catalog, model.exportState());
  assert.deepEqual(restored.actor, second);
  assert.deepEqual(restored.library(), [entry.id]);
  assert.equal(restored.audit().at(-1).actorId, second.id);
  const legacy = model.exportState();
  delete legacy.actorId;
  legacy.actorRole = 'creator';
  const migrated = createModel(catalog, legacy);
  assert.equal(migrated.actor.id, 'creator-demo');
  assert.deepEqual(migrated.library(), [entry.id]);
  for (const id of ['__proto__', 'constructor', 'missing', null]) {
    rejectsWithoutMutation(model, () => model.setAccount(id), /unknown.*account/i);
  }
});

test('profile metadata and staff roster changes never replace role capabilities', () => {
  const changed = clone(catalog);
  changed.accounts['player-demo'].permissions = ['staff.manage'];
  const model = createModel(changed);
  assert.equal(model.can('staff.manage'), false);
  model.setRole('admin');
  model.manageStaff('player-demo', 'admin', 'Assist staff', 1);
  model.setAccount('player-demo');
  assert.equal(model.actor.role, 'player');
  assert.equal(model.can('staff.manage'), false);
  model.setRole('admin');
  for (const member of model.staff()) {
    if (member.id !== model.actor.id) model.manageStaff(member.id, null, 'Remove assignment', 2);
  }
  const saved = model.exportState();
  saved.staff = [];
  const restored = createModel(catalog, saved);
  assert.deepEqual(restored.staff(), [], 'explicit saved removals never resurrect fixture staff');
});
