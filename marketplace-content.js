(function (root) {
  'use strict';
  /** Accept links without allowing script, data or credential-bearing navigation. */
  function externalUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }

  /** Return an image only when it is inert local raster data or an HTTPS resource. */
  function imageUrl(value) {
    if (typeof value !== 'string') return null;
    if (/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value) && value.length <= 360000) return value;
    return externalUrl(value);
  }

  /** Append a small Markdown subset without ever interpreting creator HTML. */
  function inline(document, parent, value) {
    const expression = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
    let at = 0;
    for (const match of value.matchAll(expression)) {
      parent.append(document.createTextNode(value.slice(at, match.index)));
      const href = match[3] && externalUrl(match[4]);
      if (match[3] && !href) parent.append(document.createTextNode(match[0]));
      else {
        const node = document.createElement(match[1] ? 'strong' : match[2] ? 'code' : 'a');
        node.textContent = match[1] || match[2] || match[3];
        if (href) { node.href = href; node.rel = 'noopener noreferrer'; }
        parent.append(node);
      }
      at = match.index + match[0].length;
    }
    parent.append(document.createTextNode(value.slice(at)));
  }

  /** Render headings, lists, paragraphs and inline emphasis as inert DOM nodes. */
  function markdown(document, value) {
    const fragment = document.createElement('div');
    fragment.className = 'markdown';
    let list = null;
    for (const line of String(value || '').slice(0, 40000).split('\n')) {
      if (!line.trim()) { list = null; continue; }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      const bullet = /^[-*]\s+(.+)$/.exec(line);
      const node = document.createElement(heading ? (heading[1].length === 3 ? 'h3' : 'h2') : bullet ? 'li' : 'p');
      inline(document, node, heading ? heading[2] : bullet ? bullet[1] : line);
      if (bullet) {
        if (!list) { list = document.createElement('ul'); fragment.append(list); }
        list.append(node);
      } else { list = null; fragment.append(node); }
    }
    return fragment;
  }

  /** Derive category from the imported client capability vocabulary when the API omits it. */
  function category(mod) {
    const caps = mod.capabilities || [];
    if (['Interface', 'Visuals', 'Camera', 'Utilities', 'Gameplay', 'Network'].includes(mod.category)) return mod.category;
    if (caps.some(name => ['packets', 'packet_delay', 'wasi'].includes(name))) return 'Network';
    if (caps.includes('camera')) return 'Camera';
    if (caps.some(name => ['movement', 'commands', 'interaction', 'item_use', 'inventory'].includes(name))) return 'Gameplay';
    if (caps.some(name => ['hud', 'screen', 'settings', 'keys', 'controls'].includes(name))) return 'Interface';
    if (caps.some(name => ['terrain', 'world_draw', 'block_highlights', 'entity_observe'].includes(name))) return 'Utilities';
    return 'Visuals';
  }

  const api = { externalUrl, imageUrl, markdown, category };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CinnabarContent = api;
})(typeof window !== 'undefined' ? window : globalThis);
