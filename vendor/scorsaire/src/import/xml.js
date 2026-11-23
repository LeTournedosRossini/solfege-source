/*
 * Small XML parser for the importers. PURE (no DOM, so the same code runs under Node and in the browser).
 * Handles: prolog, DOCTYPE (with an internal subset), comments, CDATA, processing instructions, entities, attributes in either quote style.
 * Not a validating parser. Namespaces are not interpreted (names are kept as written).
 *
 * A node is { name, attrs, children, text } where `children` holds only ELEMENT nodes (in order) and `text` is the concatenated character
 * data directly inside the element (enough for MusicXML, whose text lives in leaf elements).
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five predefined entities and numeric character references. */
export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export class XmlError extends Error {}

const NAME_END = /[\s/>]/;

/** Parses `text`; returns the root element. Throws XmlError on malformed input. */
export function parseXml(text) {
  const n = text.length;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const stack = [];
  let root = null;

  const fail = (msg) => { throw new XmlError(`XML: ${msg} (position ${i})`); };

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (stack.length && lt > i) {
      const top = stack[stack.length - 1];
      const chunk = text.slice(i, lt);
      if (chunk.trim() !== '' || top.children.length === 0) top.text += decodeEntities(chunk);
    }
    i = lt;
    const c1 = text.charCodeAt(i + 1);
    if (c1 === 33) { // <!
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        if (end < 0) fail('unterminated comment');
        i = end + 3;
      } else if (text.startsWith('<![CDATA[', i)) {
        const end = text.indexOf(']]>', i + 9);
        if (end < 0) fail('unterminated CDATA');
        if (stack.length) stack[stack.length - 1].text += text.slice(i + 9, end);
        i = end + 3;
      } else { // DOCTYPE, possibly with an internal subset in [...]
        let depth = 0; let j = i + 2;
        for (; j < n; j += 1) {
          const ch = text[j];
          if (ch === '[') depth += 1;
          else if (ch === ']') depth -= 1;
          else if (ch === '>' && depth <= 0) break;
        }
        if (j >= n) fail('unterminated declaration');
        i = j + 1;
      }
    } else if (c1 === 63) { // <?
      const end = text.indexOf('?>', i + 2);
      if (end < 0) fail('unterminated processing instruction');
      i = end + 2;
    } else if (c1 === 47) { // </name>
      const end = text.indexOf('>', i + 2);
      if (end < 0) fail('unterminated closing tag');
      const name = text.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) fail(`closing tag </${name}> does not match <${top ? top.name : '?'}>`);
      i = end + 1;
    } else { // <name attr="v" ...> or <name .../>
      let j = i + 1;
      while (j < n && !NAME_END.test(text[j])) j += 1;
      const name = text.slice(i + 1, j);
      if (!name) fail('empty element name');
      const attrs = {};
      let selfClose = false;
      for (;;) {
        while (j < n && /\s/.test(text[j])) j += 1;
        if (j >= n) fail('unterminated tag');
        const ch = text[j];
        if (ch === '>') { j += 1; break; }
        if (ch === '/') { selfClose = true; j = text.indexOf('>', j); if (j < 0) fail('unterminated tag'); j += 1; break; }
        let k = j;
        while (k < n && text[k] !== '=' && !/[\s/>]/.test(text[k])) k += 1;
        const attr = text.slice(j, k);
        while (k < n && /\s/.test(text[k])) k += 1;
        if (text[k] !== '=') fail(`attribute « ${attr} » without value`);
        k += 1;
        while (k < n && /\s/.test(text[k])) k += 1;
        const quote = text[k];
        if (quote !== '"' && quote !== "'") fail('attribute value without quotes');
        const close = text.indexOf(quote, k + 1);
        if (close < 0) fail('unterminated attribute value');
        attrs[attr] = decodeEntities(text.slice(k + 1, close));
        j = close + 1;
      }
      const node = { name, attrs, children: [], text: '' };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else if (root) fail('several root elements');
      else root = node;
      if (!selfClose) stack.push(node);
      i = j;
    }
  }
  if (stack.length) fail(`unclosed element <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlError('XML: no root element');
  return root;
}

// ---------- reading helpers ----------

/** First child element named `name`, or null. */
export function child(node, name) {
  if (!node) return null;
  for (const c of node.children) if (c.name === name) return c;
  return null;
}

/** All child elements named `name`. */
export function childrenOf(node, name) {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Trimmed text of the first child `name`, or null. */
export function childText(node, name) {
  const c = child(node, name);
  return c ? c.text.trim() : null;
}

/** Integer in the text of child `name`, or `fallback`. */
export function childInt(node, name, fallback = null) {
  const t = childText(node, name);
  if (t === null || t === '') return fallback;
  const v = Number(t);
  return Number.isFinite(v) ? Math.trunc(v) : fallback;
}

/** Number in the text of child `name`, or `fallback`. */
export function childNum(node, name, fallback = null) {
  const t = childText(node, name);
  if (t === null || t === '') return fallback;
  const v = Number(t);
  return Number.isFinite(v) ? v : fallback;
}

/** Path lookup: `path(node, 'a', 'b')` = child b of child a. */
export function path(node, ...names) {
  let cur = node;
  for (const n of names) { cur = child(cur, n); if (!cur) return null; }
  return cur;
}
