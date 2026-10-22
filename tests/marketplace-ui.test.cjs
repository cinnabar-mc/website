const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {createModel} = require('../marketplace-model.js');
const config = require('../source.json');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../.source', config.inputs.marketplace), 'utf8'));
const script = fs.readFileSync(path.join(__dirname, '../marketplace.js'), 'utf8');

/** Model the DOM operations used by the marketplace without a browser dependency. */
class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.listeners = {};
    this.attrs = {};
    this.dataset = {};
    this.className = '';
    this.value = '';
    this.ownText = '';
    this.disabled = false;
    this.classList = {
      add: name => { this.className += ' ' + name; },
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      },
    };
  }
  /** Attach children in order, moving them out of any previous parent. */
  append(...children) {
    for (const child of children) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.children.push(child);
    }
  }
  /** Detach a subtree and reproduce the browser's loss of focus to the body. */
  removeChild(child) {
    const index = this.children.indexOf(child);
    assert.notEqual(index, -1, 'removed child belongs to its parent');
    if (child.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  /** Replace content through normal detachment so stale focused nodes cannot survive. */
  replaceChildren(...children) {
    for (const child of [...this.children]) this.removeChild(child);
    this.ownText = '';
    this.append(...children);
  }
  /** Insert siblings for the controller's inline mobile detail placement. */
  after(...siblings) {
    const parent = this.parentNode;
    if (!parent) return;
    let previous = this;
    for (const sibling of siblings) {
      if (sibling.parentNode) sibling.parentNode.removeChild(sibling);
      parent.children.splice(parent.children.indexOf(previous) + 1, 0, sibling);
      sibling.parentNode = parent;
      previous = sibling;
    }
  }
  /** Check membership by ancestry, including the element itself. */
  contains(element) {
    for (let current = element; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  get isConnected() { return this.ownerDocument.body.contains(this); }
  /** Reflect the attributes used by labels, selectors and controller focus restoration. */
  setAttribute(name, value) {
    const text = String(value);
    if (name === 'class') this.className = text;
    else if (name === 'id') this.id = text;
    else if (name.startsWith('data-')) this.dataset[dataProperty(name)] = text;
    else this.attrs[name] = text;
  }
  /** Include dataset properties assigned directly by the controller in attribute queries. */
  getAttribute(name) {
    if (name === 'class') return this.className || null;
    if (name === 'id') return this.id ?? null;
    if (name.startsWith('data-')) {
      const value = this.dataset[dataProperty(name)];
      return value === undefined ? null : String(value);
    }
    if (name === 'disabled') return this.disabled ? '' : null;
    return this.attrs[name] ?? null;
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  /** Only a connected, enabled focusable element can become the document's active element. */
  focus() {
    const focusable = ['body', 'button', 'input', 'select', 'textarea', 'a'].includes(this.tagName)
      || this.tabIndex !== undefined || this.getAttribute('tabindex') !== null;
    if (this.isConnected && !this.disabled && focusable) this.ownerDocument.activeElement = this;
  }
  set textContent(value) { this.replaceChildren(); this.ownText = String(value); }
  get textContent() { return [this.ownText, ...this.children.map(child => child.textContent)].join(' '); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) { return descendants(this).filter(item => matchesSelector(item, selector)); }
  /** Find the enclosing form before a submit button invokes its listener. */
  closest(selector) {
    for (let current = this; current; current = current.parentNode) if (matchesSelector(current, selector)) return current;
    return null;
  }
}

/** Convert an HTML data attribute name into its dataset property name. */
function dataProperty(name) {
  return name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Match the tag, class, ID and presence/equality attribute selectors used by the controller. */
function matchesCompound(element, selector) {
  const tokens = selector.match(/^[\w-]+|^\*|[.#][\w-]+|\[[^\]]+\]/g) || [];
  assert.equal(tokens.join(''), selector, `supported DOM selector: ${selector}`);
  return tokens.every(token => {
    if (token === '*') return true;
    if (token.startsWith('.')) return element.className.split(/\s+/).includes(token.slice(1));
    if (token.startsWith('#')) return element.id === token.slice(1);
    if (!token.startsWith('[')) return element.tagName === token;
    const attribute = token.match(/^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/);
    assert.ok(attribute, `supported DOM attribute selector: ${token}`);
    const [, name, doubleQuoted, singleQuoted, unquoted] = attribute;
    const expected = doubleQuoted ?? singleQuoted ?? unquoted;
    const actual = element.getAttribute(name);
    return expected === undefined ? actual !== null : actual === expected;
  });
}

/** Match descendant selectors without treating whitespace inside attribute values as a separator. */
function matchesSelector(element, selector) {
  return selector.split(',').some(part => {
    const compounds = part.trim().match(/(?:\[[^\]]*\]|[^\s])+/g) || [];
    if (!compounds.length || !matchesCompound(element, compounds.at(-1))) return false;
    let ancestor = element.parentNode;
    for (let index = compounds.length - 2; index >= 0; index--) {
      while (ancestor && !matchesCompound(ancestor, compounds[index])) ancestor = ancestor.parentNode;
      if (!ancestor) return false;
      ancestor = ancestor.parentNode;
    }
    return true;
  });
}

/** Return descendants in document order for querying public labels and controls. */
function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

/** Provide connected document roots and a single current focus target. */
class Document {
  constructor() {
    this.body = new Element('body', this);
    this.activeElement = this.body;
  }
  createElement(tag) { return new Element(tag, this); }
  createElementNS(_, tag) { return this.createElement(tag); }
  getElementById(id) { return [this.body, ...descendants(this.body)].find(element => element.id === id) ?? null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) { return [this.body, ...descendants(this.body)].filter(element => matchesSelector(element, selector)); }
}

/** Read public button names, including catalog cards labeled for assistive technology. */
function nameOf(control) {
  return (control.getAttribute('aria-label') ?? control.textContent).replace(/\s+/g, ' ').trim();
}

/** Require live keyboard focus on the actual current control, rather than a detached predecessor. */
function assertFocus(p, control) {
  assert.equal(control.isConnected, true, `${nameOf(control)} is connected`);
  assert.equal(control.disabled, false, `${nameOf(control)} is enabled`);
  assert.ok(p.document.activeElement === control, `keyboard focus is on ${nameOf(control)}`);
}

/** Load the real controller with the shared catalog and explicit in-memory storage. */
async function page(source = catalog, {storage = new Map(), mobile = false} = {}) {
  const document = new Document();
  for (const [id, tag] of [
    ['workspace', 'div'], ['feedback', 'p'], ['demo-role', 'select'], ['workspace-nav', 'nav'],
    ['role-indicator', 'span'], ['demo-toggle', 'button'], ['demo-controls', 'div'],
    ['signin-link', 'button'], ['reset-demo', 'button'],
  ]) {
    const control = document.createElement(tag);
    control.id = id;
    document.body.append(control);
  }
  const element = id => {
    const found = document.getElementById(id);
    assert.ok(found, `element ${id} exists`);
    return found;
  };
  let roleModel;
  const mediaListeners = new Set();
  const media = {
    get matches() { return mobile; },
    addEventListener(event, listener) {
      if (event === 'change') mediaListeners.add(listener);
    },
  };
  const window = {CinnabarMarketplace: {createModel(...args) { roleModel = createModel(...args); return roleModel; }}};
  vm.runInNewContext(script, {
    window, document,
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    fetch: async () => ({ok: true, json: async () => source}),
    matchMedia: () => media,
    location: {reload() {}}, Date,
  });
  for (let turn = 0; turn < 10 && !element('workspace').children.length; turn++) await Promise.resolve();
  assert.ok(roleModel, 'catalog initialized');
  /** Locate a current control through its public name within the requested region. */
  const query = (text, tag = 'button', root = document.body) =>
    descendants(root).find(value => value.tagName === tag && nameOf(value) === text) ?? null;
  /** Activate like a keyboard user, allowing submit buttons without click listeners. */
  const click = control => {
    assert.equal(control.isConnected, true, 'activated control is connected');
    assert.equal(control.disabled, false, 'activated control is enabled');
    control.focus();
    control.listeners.click?.({currentTarget: control, target: control, preventDefault() {}});
  };
  return {
    document, element, model: roleModel, query, click,
    /** Cross the responsive breakpoint and dispatch its actual change subscribers. */
    resize(nextMobile) {
      if (mobile === nextMobile) return;
      mobile = nextMobile;
      for (const listener of mediaListeners) listener({matches: mobile});
    },
    find(text, tag = 'button', root = document.body) {
      const found = query(text, tag, root);
      assert.ok(found, `${tag} labeled ${text} exists`);
      return found;
    },
    /** Locate a desk entry by its title, allowing its status text to change. */
    row(title) {
      const found = element('workspace').querySelectorAll('.desk-list button')
        .find(control => nameOf(control).startsWith(title + ' '));
      assert.ok(found, `desk row labeled ${title} exists`);
      return found;
    },
    /** Locate the input associated with an authored form label. */
    field(text) {
      const label = element('workspace').querySelectorAll('label').find(control => control.ownText === text);
      const control = label?.querySelector('input, textarea, select');
      assert.ok(control, `form control labeled ${text} exists`);
      return control;
    },
    /** Focus the chosen submit action and pass it as the form event's submitter. */
    submit(control) {
      const form = control.closest('form');
      assert.ok(form, 'submit button belongs to a form');
      assert.equal(control.type, 'submit');
      click(control);
      form.listeners.submit({preventDefault() {}, submitter: control});
    },
    role(role) {
      const select = element('demo-role');
      select.focus();
      select.value = role;
      select.listeners.change({currentTarget: select});
    },
    /** Decode the persisted demo record independently of the live model. */
    saved() {
      assert.equal(storage.size, 1, 'demo state is persisted in one storage record');
      return JSON.parse([...storage.values()][0]);
    },
    /** Start a fresh controller against the same browser storage. */
    reload() { return page(source, {storage, mobile}); },
  };
}

/** Fill a valid creator draft using the shared catalog's existing field examples. */
function fillSubmission(p, title) {
  const example = catalog.listings.find(entry => entry.status === 'published');
  assert.ok(example, 'the shared source includes a published example');
  for (const [label, value] of [
    ['Mod name', title], ['Version', example.version], ['Category', example.category],
    ['License', example.license], ['Short description', example.summary],
    ['About this mod', example.description], ['Requested permissions · one per line', example.permissions.join('\n')],
  ]) p.field(label).value = value;
}

test('detaching focused subtrees returns focus to body and detached or disabled controls cannot regain it', () => {
  const document = new Document();
  const container = document.createElement('section');
  const control = document.createElement('button');
  container.append(control);
  document.body.append(container);
  control.focus();
  assert.equal(document.activeElement, control);
  assert.equal(container.contains(control), true);
  assert.equal(control.parentNode, container);
  document.body.replaceChildren(document.createElement('main'));
  assert.equal(document.activeElement, document.body);
  assert.equal(container.parentNode, null);
  assert.equal(control.isConnected, false);
  control.focus();
  assert.equal(document.activeElement, document.body);
  document.body.append(container);
  control.disabled = true;
  control.focus();
  assert.equal(document.activeElement, document.body);
  control.disabled = false;
  control.focus();
  assert.equal(document.activeElement, control);
  container.textContent = 'Replacement content';
  assert.equal(document.activeElement, document.body);
  assert.equal(control.parentNode, null);
  assert.equal(container.contains(control), false);
});

test('review queue opens a pending submission before published listing management', async () => {
  const p = await page();
  p.role('moderator');
  p.click(p.find('Review queue'));
  const pending = catalog.listings.find(entry => entry.status === 'pending');
  assert.ok(pending, 'the shared source includes a pending example');
  assert.equal(p.element('workspace').querySelector('.review-panel h2').textContent.trim(), pending.title);
  assert.ok(p.find('Approve'));
  assert.ok(p.find('Request changes'));
});

test('library actions change local state and the sign-in view remains unavailable', async () => {
  const p = await page();
  p.click(p.find('Add to demo library'));
  assert.equal(p.model.library().length, 1);
  assert.match(p.element('feedback').textContent, /No files were downloaded/);
  assertFocus(p, p.find('Remove from demo library'));
  p.click(p.find('Remove from demo library'));
  assert.equal(p.model.library().length, 0);
  assertFocus(p, p.find('Add to demo library'));
  p.click(p.element('signin-link'));
  assert.equal(p.find('Microsoft sign-in unavailable').disabled, true);
  assert.match(p.element('workspace').textContent, /No Microsoft account is connected/);
});

test('review form reason requirements follow each catalog rule and audit shows the actor', async () => {
  const varied = JSON.parse(JSON.stringify(catalog));
  const approve = varied.review_transitions.find(rule => rule.action === 'approve');
  approve.requires_reason = false;
  const p = await page(varied);
  p.role('moderator');
  p.click(p.find('Review queue'));
  const panel = p.element('workspace').querySelector('.review-panel');
  const reason = panel.querySelector('textarea');
  const changes = p.find('Request changes');
  p.click(changes);
  assert.equal(reason.required, true);
  const approval = p.find('Approve');
  p.click(approval);
  assert.equal(reason.required, false);
  p.submit(approval);
  assert.equal(p.model.audit().at(-1).action, approve.action);
  p.role('admin');
  p.click(p.find('Staff & audit'));
  assert.match(p.element('workspace').textContent, /moderator-demo/);
  assert.match(p.element('workspace').textContent, /pending → published/);
});

test('suspended selections remain counted, persisted and removable in the player library', async () => {
  let p = await page();
  const published = catalog.listings.find(entry => entry.status === 'published');
  assert.ok(published, 'the shared source includes a published example');
  assert.equal(p.model.actor.role, 'player');
  const playerId = p.model.actor.id;
  p.click(p.find(`View ${published.title}`));
  p.click(p.find('Add to demo library'));
  assert.deepEqual(p.model.library(), [published.id]);
  assert.deepEqual(p.saved().libraries[playerId], [published.id]);
  assertFocus(p, p.find('Remove from demo library'));

  p.role('moderator');
  p.click(p.find('Review queue'));
  p.click(p.row(published.title));
  assert.equal(p.element('workspace').querySelector('.review-panel h2').textContent.trim(), published.title);
  const reason = 'This demo listing needs a permission review.';
  p.field('Review reason').value = reason;
  p.submit(p.find('Suspend'));
  assert.equal(p.model.listings().find(entry => entry.id === published.id).status, 'suspended');
  assert.equal(p.model.audit().at(-1).reason, reason);

  p.role('player');
  assert.equal(p.query(`View ${published.title}`), null, 'suspended listing is absent from discovery');
  assert.deepEqual(p.model.library(), [published.id]);
  assert.deepEqual(p.saved().libraries[playerId], [published.id]);
  p.click(p.find('Demo library (1)'));
  assert.ok(p.find(`View ${published.title}`));
  assert.match(p.element('workspace').querySelector('.results-label').textContent, /1 mod in your demo library/);
  assert.equal(p.element('workspace').querySelector('.detail .badge').textContent.trim(), 'Suspended');
  assert.doesNotMatch(p.element('workspace').textContent, /Your demo library is empty/);
  assert.ok(p.find('Remove from demo library'));
  const search = p.field('Search mods');
  search.focus();
  search.value = published.title;
  search.listeners.input();
  assertFocus(p, search);
  const category = p.field('Category');
  assert.ok(p.find(published.category, 'option', category), 'unavailable library category remains selectable');
  category.focus();
  category.value = published.category;
  category.listeners.change();
  assertFocus(p, category);
  assert.ok(p.find(`View ${published.title}`), 'library filters keep the selected unavailable listing');
  assert.ok(p.find('Remove from demo library'));

  p = await p.reload();
  assert.equal(p.model.actor.role, 'player');
  assert.equal(p.query(`View ${published.title}`), null);
  p.click(p.find('Demo library (1)'));
  assert.ok(p.find(`View ${published.title}`));
  assert.equal(p.element('workspace').querySelector('.detail .badge').textContent.trim(), 'Suspended');
  const remove = p.find('Remove from demo library');
  p.click(remove);
  assert.equal(remove.isConnected, false);
  assert.deepEqual(p.model.library(), []);
  assert.deepEqual(p.saved().libraries[playerId], []);
  assert.ok(p.find('Demo library (0)'));
  assert.match(p.element('workspace').textContent, /Your demo library is empty/);
  assertFocus(p, p.find('Explore mods'));

  p = await p.reload();
  p.click(p.find('Demo library (0)'));
  assert.deepEqual(p.model.library(), []);
  assert.equal(p.query('Remove from demo library'), null);
  assert.match(p.element('workspace').textContent, /Your demo library is empty/);
});

test('workspace navigation restores focus to the same newly rendered navigation button', async () => {
  const p = await page();
  for (const [role, labels] of [
    ['player', ['Demo library (0)', 'Explore']],
    ['creator', ['Creator workspace', 'Explore']],
    ['admin', ['Review queue', 'Staff & audit', 'Explore']],
  ]) {
    p.role(role);
    for (const label of labels) {
      const previous = p.find(label);
      p.click(previous);
      const replacement = p.find(label);
      assert.notEqual(replacement, previous);
      assert.equal(previous.isConnected, false);
      assert.equal(replacement.getAttribute('aria-current'), 'page');
      assertFocus(p, replacement);
    }
  }
});

test('creator desk selection keeps focus on the same logical row after rendering', async () => {
  const p = await page();
  p.role('creator');
  p.click(p.find('Creator workspace'));
  const own = p.model.listings().filter(entry => entry.owner === p.model.actor.id);
  assert.ok(own.length > 1, 'the shared source includes multiple creator rows');
  for (const entry of own) {
    const previous = p.row(entry.title);
    p.click(previous);
    const replacement = p.row(entry.title);
    assert.notEqual(replacement, previous);
    assert.equal(previous.isConnected, false);
    assert.equal(replacement.getAttribute('aria-pressed'), 'true');
    assertFocus(p, replacement);
    assert.equal(p.element('workspace').querySelector('.detail h2').textContent.trim(), entry.title);
  }
});

test('review desk selection keeps focus on the same logical row after rendering', async () => {
  const p = await page();
  p.role('moderator');
  p.click(p.find('Review queue'));
  const eligible = p.model.listings().filter(entry => p.model.transitions(entry.id).length);
  assert.ok(eligible.length > 1, 'the shared source includes multiple review rows');
  for (const entry of eligible) {
    const previous = p.row(entry.title);
    p.click(previous);
    const replacement = p.row(entry.title);
    assert.notEqual(replacement, previous);
    assert.equal(previous.isConnected, false);
    assert.equal(replacement.getAttribute('aria-pressed'), 'true');
    assertFocus(p, replacement);
    assert.equal(p.element('workspace').querySelector('.review-panel h2').textContent.trim(), entry.title);
  }
});

test('saving a new draft and saving edits keep focus on Save draft', async () => {
  const p = await page();
  p.role('creator');
  p.click(p.find('Creator workspace'));
  const title = 'Keyboard continuity sample';
  fillSubmission(p, title);
  const firstSave = p.find('Save draft');
  p.submit(firstSave);
  assert.equal(firstSave.isConnected, false);
  const draft = p.model.listings().find(entry => entry.title === title);
  assert.ok(draft, 'saving creates the draft');
  assert.equal(draft.status, 'draft');
  assertFocus(p, p.find('Save draft'));
  assert.equal(p.row(title).getAttribute('aria-pressed'), 'true');

  const summary = 'An updated description for the saved keyboard sample.';
  p.field('Short description').value = summary;
  const secondSave = p.find('Save draft');
  p.submit(secondSave);
  assert.equal(secondSave.isConnected, false);
  assert.equal(p.model.listings().find(entry => entry.id === draft.id).summary, summary);
  assertFocus(p, p.find('Save draft'));
  assert.equal(p.saved().submissions.find(entry => entry.id === draft.id).summary, summary);
});

test('submitting a creator draft hands focus to its selected read-only desk row', async () => {
  const p = await page();
  p.role('creator');
  p.click(p.find('Creator workspace'));
  const title = 'Submission focus sample';
  fillSubmission(p, title);
  const submit = p.find('Submit for demo review');
  p.submit(submit);
  assert.equal(submit.isConnected, false);
  assert.equal(p.query('Submit for demo review'), null);
  assert.equal(p.model.listings().find(entry => entry.title === title).status, 'pending');
  assert.match(p.row(title).textContent, /Pending/);
  assert.equal(p.row(title).getAttribute('aria-pressed'), 'true');
  assertFocus(p, p.row(title));
});

test('approval hands focus to the same selected review row when its action disappears', async () => {
  const p = await page();
  p.role('moderator');
  p.click(p.find('Review queue'));
  const pending = catalog.listings.find(entry => entry.status === 'pending');
  assert.ok(pending, 'the shared source includes a pending example');
  p.click(p.row(pending.title));
  p.field('Review reason').value = 'The requested permissions match the description.';
  const approval = p.find('Approve');
  p.submit(approval);
  assert.equal(approval.isConnected, false);
  assert.equal(p.query('Approve'), null);
  assert.equal(p.model.listings().find(entry => entry.id === pending.id).status, 'published');
  assert.ok(p.find('Suspend'));
  assert.equal(p.row(pending.title).getAttribute('aria-pressed'), 'true');
  assertFocus(p, p.row(pending.title));
});

test('reviewing an entry out of the queue hands focus to the next eligible review row', async () => {
  const p = await page();
  p.role('moderator');
  p.click(p.find('Review queue'));
  const pending = catalog.listings.find(entry => entry.status === 'pending');
  assert.ok(pending, 'the shared source includes a pending example');
  p.click(p.row(pending.title));
  p.field('Review reason').value = 'Please clarify the requested permissions.';
  const requestChanges = p.find('Request changes');
  p.submit(requestChanges);
  assert.equal(requestChanges.isConnected, false);
  assert.equal(p.model.listings().find(entry => entry.id === pending.id).status, 'changes_requested');
  const next = p.model.listings().find(entry => p.model.transitions(entry.id).length);
  assert.ok(next, 'another reviewable listing remains');
  assert.equal(p.element('workspace').querySelector('.review-panel h2').textContent.trim(), next.title);
  assert.equal(p.row(next.title).getAttribute('aria-pressed'), 'true');
  assertFocus(p, p.row(next.title));
});

test('reviewing the last eligible entry hands focus to Review queue navigation', async () => {
  const source = JSON.parse(JSON.stringify(catalog));
  const pending = source.listings.find(entry => entry.status === 'pending');
  assert.ok(pending, 'the shared source includes a pending example');
  source.listings = [pending];
  const p = await page(source);
  p.role('moderator');
  p.click(p.find('Review queue'));
  p.field('Review reason').value = 'Please clarify the requested permissions.';
  const requestChanges = p.find('Request changes');
  p.submit(requestChanges);
  assert.equal(requestChanges.isConnected, false);
  assert.equal(p.model.listings().find(entry => entry.id === pending.id).status, 'changes_requested');
  assert.match(p.element('workspace').textContent, /No entries to review/);
  assert.equal(p.element('workspace').querySelector('.desk-list'), null);
  assertFocus(p, p.find('Review queue'));
});

test('granting and removing a staff assignment keep focus on the submit control', async () => {
  const p = await page();
  p.role('admin');
  p.click(p.find('Staff & audit'));
  const role = Object.keys(catalog.roles).find(role => catalog.roles[role].includes('submission.review'));
  assert.ok(role, 'the shared policy includes a review-capable staff role');
  const account = 'keyboard-reviewer';
  p.field('Demo account ID').value = account;
  p.field('Assignment').value = role;
  p.field('Reason').value = 'Help review the local demo queue.';
  const grant = p.find('Save demo assignment');
  p.submit(grant);
  assert.equal(grant.isConnected, false);
  assert.equal(p.model.staff().find(member => member.id === account).role, role);
  assertFocus(p, p.find('Save demo assignment'));

  p.click(p.find('Edit assignment'));
  assertFocus(p, p.field('Reason'));
  assert.equal(p.field('Demo account ID').value, account);
  p.field('Assignment').value = '';
  p.field('Reason').value = 'The local demo review is complete.';
  const remove = p.find('Save demo assignment');
  p.submit(remove);
  assert.equal(remove.isConnected, false);
  assert.equal(p.model.staff().some(member => member.id === account), false);
  assert.equal(p.saved().staff.some(member => member.id === account), false);
  assert.equal(p.model.audit().at(-1).action, 'staff.remove');
  assertFocus(p, p.find('Save demo assignment'));
});

for (const mobile of [false, true]) {
  test(`responsive reflow preserves catalog and library focus starting on ${mobile ? 'mobile' : 'desktop'}`, async () => {
    const p = await page(catalog, {mobile});
    const entry = catalog.listings.find(entry => entry.status === 'published');
    const card = p.find(`View ${entry.title}`);
    card.focus();
    p.resize(!mobile);
    assert.equal(card.isConnected, false);
    assertFocus(p, p.find(`View ${entry.title}`));

    const add = p.find('Add to demo library');
    add.focus();
    p.resize(mobile);
    assert.equal(add.isConnected, false);
    assertFocus(p, p.find('Add to demo library'));

    p.click(p.find('Add to demo library'));
    p.click(p.find('Demo library (1)'));
    for (const nextMobile of [!mobile, mobile]) {
      const remove = p.find('Remove from demo library');
      remove.focus();
      p.resize(nextMobile);
      assert.equal(remove.isConnected, false);
      assertFocus(p, p.find('Remove from demo library'));
    }

    const search = p.field('Search mods');
    search.focus();
    p.resize(!mobile);
    assertFocus(p, search);
    const outside = p.element('demo-toggle');
    outside.focus();
    p.resize(mobile);
    assertFocus(p, outside);
  });

  test(`catalog row selection preserves focus on the replacement card on ${mobile ? 'mobile' : 'desktop'}`, async () => {
    const p = await page(catalog, {mobile});
    const published = catalog.listings.filter(entry => entry.status === 'published');
    assert.ok(published.length > 1, 'the shared source includes multiple published examples');
    for (const entry of published.slice(0, 2)) {
      const previous = p.find(`View ${entry.title}`);
      p.click(previous);
      const replacement = p.find(`View ${entry.title}`);
      assert.notEqual(replacement, previous);
      assert.equal(previous.isConnected, false);
      assert.equal(replacement.getAttribute('aria-pressed'), 'true');
      assertFocus(p, replacement);
      const detail = p.element('workspace').querySelector('.detail');
      assert.equal(detail.isConnected, true);
      assert.equal(detail.querySelector('h2').textContent.trim(), entry.title);
    }
  });
}

test('library removal focuses the remaining detail action, then the empty-library recovery', async () => {
  const p = await page();
  const entries = catalog.listings.filter(entry => entry.status === 'published').slice(0, 2);
  assert.equal(entries.length, 2, 'the shared source includes two published examples');
  const actorId = p.model.actor.id;
  for (const entry of entries) {
    p.click(p.find(`View ${entry.title}`));
    p.click(p.find('Add to demo library'));
    assertFocus(p, p.find('Remove from demo library'));
  }
  p.click(p.find('Demo library (2)'));
  p.click(p.find(`View ${entries[0].title}`));
  const firstRemove = p.find('Remove from demo library');
  p.click(firstRemove);
  assert.equal(firstRemove.isConnected, false);
  assert.deepEqual(p.model.library(), [entries[1].id]);
  assert.deepEqual(p.saved().libraries[actorId], [entries[1].id]);
  assert.ok(p.find('Demo library (1)'));
  assert.equal(p.element('workspace').querySelector('.detail h2').textContent.trim(), entries[1].title);
  assertFocus(p, p.find('Remove from demo library'));

  const lastRemove = p.find('Remove from demo library');
  p.click(lastRemove);
  assert.equal(lastRemove.isConnected, false);
  assert.deepEqual(p.model.library(), []);
  assert.deepEqual(p.saved().libraries[actorId], []);
  assert.ok(p.find('Demo library (0)'));
  assertFocus(p, p.find('Explore mods'));
  p.click(p.find('Explore mods'));
  assertFocus(p, p.find('Add to demo library'));
  assert.ok(p.find(`View ${entries[0].title}`));
});
