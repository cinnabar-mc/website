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
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.attrs = {};
    this.dataset = {};
    this.className = '';
    this.value = '';
    this.ownText = '';
    this.classList = {
      add: name => { this.className += ' ' + name; },
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      },
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  focus() { this.focused = true; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return [this.ownText, ...this.children.map(child => child.textContent)].join(' '); }
  querySelector(selector) {
    const [first, ...rest] = selector.split(' ');
    const found = descendants(this).find(item => first.startsWith('.')
      ? item.className.split(' ').includes(first.slice(1)) : item.tagName === first);
    return rest.length && found ? found.querySelector(rest.join(' ')) : found || null;
  }
}

/** Return descendants in document order for querying public labels and controls. */
function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

/** Load the real controller with the shared catalog and explicit in-memory storage. */
async function page(source = catalog) {
  const ids = new Map();
  const element = id => {
    const generated = [...ids.values()].flatMap(value => [value, ...descendants(value)]).find(value => value.id === id);
    if (generated) return generated;
    if (!ids.has(id)) ids.set(id, new Element('div'));
    return ids.get(id);
  };
  const state = new Map();
  let roleModel;
  const window = {CinnabarMarketplace: {createModel(...args) { roleModel = createModel(...args); return roleModel; }}};
  vm.runInNewContext(script, {
    window, document: {getElementById: element, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag)},
    localStorage: {getItem: key => state.get(key), setItem: (key, value) => state.set(key, value)},
    fetch: async () => ({ok: true, json: async () => source}),
    matchMedia: () => ({matches: false, addEventListener() {}}),
    location: {reload() {}}, Date,
  });
  for (let turn = 0; turn < 10 && !element('workspace').children.length; turn++) await Promise.resolve();
  assert.ok(roleModel, 'catalog initialized');
  return {
    element, model: roleModel,
    find(text, tag = 'button') {
      const found = [...ids.values()].flatMap(value => [value, ...descendants(value)])
        .find(value => value.tagName === tag && value.textContent.trim() === text);
      assert.ok(found, `${tag} labeled ${text} exists`);
      return found;
    },
    click(control) { control.listeners.click({currentTarget: control}); },
    role(role) { element('demo-role').value = role; element('demo-role').listeners.change(); },
  };
}

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
  p.click(p.find('Remove from demo library'));
  assert.equal(p.model.library().length, 0);
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
  const form = panel.querySelector('form');
  form.listeners.submit({preventDefault() {}, submitter: approval});
  assert.equal(p.model.audit().at(-1).action, approve.action);
  p.role('admin');
  p.click(p.find('Staff & audit'));
  assert.match(p.element('workspace').textContent, /moderator-demo/);
  assert.match(p.element('workspace').textContent, /pending → published/);
});
