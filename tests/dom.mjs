/**
 * The smallest DOM that quiz.js actually asks for, so the quiz engine and the
 * scoreboard can be tested in Node with nothing installed.
 *
 * Only what the engine touches is here: elements, text, classes, one listener
 * list per event name, and a localStorage that lives in a Map.
 */
import fs from 'node:fs';

class Classes {
  constructor(node) {
    this.node = node;
  }
  list() {
    return String(this.node.className || '').split(/\s+/).filter(Boolean);
  }
  write(list) {
    this.node.className = list.join(' ');
  }
  contains(name) {
    return this.list().indexOf(name) >= 0;
  }
  add(name) {
    if (!this.contains(name)) this.write(this.list().concat(name));
  }
  remove(name) {
    this.write(
      this.list().filter(function (one) {
        return one !== name;
      })
    );
  }
  toggle(name, on) {
    const want = on === undefined ? !this.contains(name) : !!on;
    if (want) this.add(name);
    else this.remove(name);
  }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = Object.create(null);
    this.listeners = Object.create(null);
    this.className = '';
    this.own = '';
    this.style = { setProperty: (name, value) => (this.style[name] = value) };
  }
  get classList() {
    return new Classes(this);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get children() {
    return this.childNodes.filter((kid) => kid.tagName);
  }
  get textContent() {
    return this.own + this.childNodes.map((kid) => kid.textContent).join('');
  }
  set textContent(value) {
    this.childNodes = [];
    this.own = String(value == null ? '' : value);
  }
  appendChild(kid) {
    if (kid.parentNode) kid.parentNode.removeChild(kid);
    kid.parentNode = this;
    this.childNodes.push(kid);
    return kid;
  }
  removeChild(kid) {
    const at = this.childNodes.indexOf(kid);
    if (at >= 0) this.childNodes.splice(at, 1);
    kid.parentNode = null;
    return kid;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === 'id' || name === 'value' || name === 'type' || name === 'name') this[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  addEventListener(name, fn) {
    (this.listeners[name] || (this.listeners[name] = [])).push(fn);
  }
}

const walk = (node, out = []) => {
  out.push(node);
  node.childNodes.forEach((kid) => walk(kid, out));
  return out;
};

export function all(root, sel) {
  const found = walk(root);
  if (sel.charAt(0) === '.') return found.filter((node) => node.classList.contains(sel.slice(1)));
  const tag = sel.toUpperCase();
  return found.filter((node) => node.tagName === tag);
}

export const one = (root, sel) => all(root, sel)[0] || null;

export const hidden = (node) => node.classList.contains('hidden');

/** Runs the listeners a real click or keystroke would. */
export function fire(node, name, extra) {
  const event = Object.assign({ type: name, target: node, preventDefault() {}, stopPropagation() {} }, extra);
  (node.listeners[name] || []).forEach((fn) => fn(event));
  return event;
}

export function press(node, name, extra) {
  return fire(node, name || 'click', extra);
}

class Store {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

/** A clean page, a clean store, and a record of print/scroll calls. */
export function reset() {
  const document = {
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => {
      const node = new Node('');
      node.own = String(text == null ? '' : text);
      return node;
    },
    body: new Node('body'),
    getElementById(id) {
      return walk(document.body).find((node) => node.attrs.id === id) || null;
    },
  };
  const calls = { print: 0, scroll: 0 };
  globalThis.document = document;
  globalThis.localStorage = new Store();
  globalThis.print = () => (calls.print += 1);
  globalThis.scrollTo = () => (calls.scroll += 1);
  const host = document.createElement('main');
  const dock = document.createElement('div');
  document.body.appendChild(host);
  document.body.appendChild(dock);
  return { document, host, dock, calls, store: globalThis.localStorage };
}

/** Loads our classic scripts into this global, in order, once. */
export function load(...names) {
  names.forEach((name) => {
    const source = fs.readFileSync(new URL('../assets/js/' + name, import.meta.url), 'utf8');
    new Function(source)();
  });
  return globalThis.AR;
}
