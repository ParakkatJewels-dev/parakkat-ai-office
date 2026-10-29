import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' };
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object') return text(tree.props.children);
  return tree == null || typeof tree === 'boolean' ? '' : String(tree);
}
class Element { closest() { return null; } }
class HTMLElement extends Element { focus() { this.focused = true; } }
class HTMLFormElement extends HTMLElement {
  constructor(options = {}) { super(); Object.assign(this, { filter: false, method: 'post', action: 'https://office.example/admin', target: '', data: [] }, options); }
  getAttribute(name) { return name === 'data-settings-filter' && this.filter ? 'true' : null; }
}
class HTMLButtonElement extends HTMLElement {}
class HTMLInputElement extends HTMLElement {
  constructor(form, options = {}) { super(); Object.assign(this, { form, name: 'setting', type: 'text', value: '', defaultValue: '', checked: false, defaultChecked: false, disabled: false }, options); }
  matches() { return this.disabled; }
}
class HTMLTextAreaElement extends HTMLElement {
  constructor(form, options = {}) { super(); Object.assign(this, { form, name: 'setting', value: '', defaultValue: '', disabled: false }, options); }
  matches() { return this.disabled; }
}
class HTMLSelectElement extends HTMLElement {
  constructor(form, options, multiple = false) { super(); Object.assign(this, { form, name: 'setting', options, multiple, disabled: false }); }
  matches() { return this.disabled; }
}
class HTMLAnchorElement extends HTMLElement {
  constructor(href, options = {}) { super(); Object.assign(this, { href: new URL(href, 'https://office.example/admin?tab=brand').href, target: '', download: false }, options); }
  closest() { return this; }
  hasAttribute(name) { return name === 'download' && this.download; }
}
function event(options = {}) {
  return { defaultPrevented: false, stopped: false, ...options, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
}

function harness() {
  const states = [], effects = [], effectQueue = [], documentListeners = new Map(), windowListeners = new Map(), contentListeners = new Map(), navigations = [];
  const forms = [new HTMLFormElement()], controls = [new HTMLInputElement(forms[0], { value: 'Saved', defaultValue: 'Saved' })];
  const content = Object.assign(new HTMLElement(), {
    busy: false,
    querySelectorAll: () => controls,
    querySelector: () => content.busy ? {} : null,
    contains: form => forms.includes(form),
    addEventListener: (name, fn, capture) => contentListeners.set(`${name}:${capture}`, fn),
    removeEventListener: (name, fn, capture) => contentListeners.delete(`${name}:${capture}`),
  });
  const active = new HTMLElement(), document = {
    activeElement: active,
    addEventListener: (name, fn, capture) => documentListeners.set(`${name}:${capture}`, fn),
    removeEventListener: (name, fn, capture) => documentListeners.delete(`${name}:${capture}`),
  };
  const window = {
    location: new URL('https://office.example/admin?tab=brand'),
    addEventListener: (name, fn) => windowListeners.set(name, fn),
    removeEventListener: name => windowListeners.delete(name),
  };
  let cursor = 0, dirty = false, tree, observer;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { const next = typeof value === 'function' ? value(states[index]) : value; if (!Object.is(next, states[index])) { states[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
    useId() { return `id-${cursor++}`; },
    useEffect(fn, deps) { const index = cursor++; if (!effects[index] || !equal(effects[index].deps, deps)) effectQueue.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; }); },
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  class FormData { constructor(form) { this.values = form.data; } forEach(fn) { this.values.forEach(([name, value]) => fn(value, name)); } }
  const environment = { window, document, Element, HTMLElement, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, HTMLAnchorElement, HTMLFormElement, HTMLButtonElement, MutationObserver, FormData };
  const code = ts.transpileModule(readFileSync(new URL('../src/app/(app)/admin/SettingsDraftGuard.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}, modules = { react, 'next/navigation': { useRouter: () => ({ push: href => navigations.push(href) }) }, 'react/jsx-runtime': jsx };
  new Function('exports', 'require', ...Object.keys(environment), code)(exports, name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, ...Object.values(environment));
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; nodes(tree, n => n.type === 'dialog')[0].props.onClose(); } };
  function render() {
    cursor = 0; dirty = false; tree = exports.SettingsDraftGuard({ children: 'Settings content', className: 'content' });
    nodes(tree, n => n.type === 'div' && n.props.className === 'content')[0].props.ref.current = content;
    nodes(tree, n => n.type === 'dialog')[0].props.ref.current = dialog;
    while (effectQueue.length) effectQueue.shift()();
  }
  function flush() { let times = 0; while (dirty) { assert.ok(++times < 20, 'Hooks should settle'); render(); } }
  render(); flush();
  return {
    controls, forms, content, navigations, active, dialog, documentListeners, windowListeners, contentListeners,
    get tree() { return tree; },
    hasDraft: () => exports.hasSettingsDraft(content),
    change(value) { controls[0].value = value; contentListeners.get('input:undefined')?.(); flush(); },
    link(href, options = {}) { const e = event({ target: new HTMLAnchorElement(href, options), button: 0, ...options }); documentListeners.get('click:true')(e); flush(); return e; },
    search(href) { const e = event({ cancelable: true, detail: { href } }); windowListeners.get('workspace:navigate')(e); flush(); return e; },
    unload() { const e = event(); windowListeners.get('beforeunload')(e); return e; },
    submit(form = forms[0]) { const e = event({ target: form }); contentListeners.get('submit:true')(e); flush(); return e; },
    busy(value) { const old = content.busy; content.busy = value; observer.callback([{ attributeName: 'aria-busy', oldValue: String(old) }]); flush(); },
    click(label) { const button = nodes(tree, n => n.type === 'button' && text(n) === label)[0]; assert.ok(button, `Missing ${label}`); assert.ok(!button.props.disabled); button.props.onClick(); flush(); },
    escape() { const e = event(); nodes(tree, n => n.type === 'dialog')[0].props.onCancel(e); flush(); return e; },
    actionButton() { const e = event({ target: new HTMLElement(), button: 0 }); documentListeners.get('click:true')(e); flush(); return e; },
    unmount() { for (const effect of effects) effect?.cleanup?.(); assert.equal(observer.connected, false); },
  };
}

test('settings drafts compare native controls and become clean when values are restored', () => {
  const h = harness();
  assert.equal(h.hasDraft(), false);
  for (const type of ['text', 'password', 'date', 'email']) {
    Object.assign(h.controls[0], { type, value: 'Changed', defaultValue: 'Saved' });
    assert.equal(h.hasDraft(), true, `${type} change`);
    h.controls[0].value = 'Saved'; assert.equal(h.hasDraft(), false, `${type} restored`);
  }
  for (const type of ['checkbox', 'radio']) {
    Object.assign(h.controls[0], { type, checked: true, defaultChecked: false });
    assert.equal(h.hasDraft(), true); h.controls[0].checked = false; assert.equal(h.hasDraft(), false);
  }
  h.controls[0] = new HTMLTextAreaElement(h.forms[0], { value: 'Draft brand guidance', defaultValue: 'Saved brand guidance' });
  assert.equal(h.hasDraft(), true);
  h.controls[0].value = 'Saved brand guidance'; assert.equal(h.hasDraft(), false);
  h.controls[0] = new HTMLSelectElement(h.forms[0], [{ selected: false, defaultSelected: true }, { selected: true, defaultSelected: false }]);
  assert.equal(h.hasDraft(), true);
  h.controls[0].options.forEach(option => { option.selected = option.defaultSelected; }); assert.equal(h.hasDraft(), false);
  h.controls[0] = new HTMLSelectElement(h.forms[0], [{ selected: true, defaultSelected: false }, { selected: false, defaultSelected: false }]);
  assert.equal(h.hasDraft(), false, 'first option is the native default when none is explicitly selected');
  h.controls[0] = new HTMLSelectElement(h.forms[0], [{ selected: false, defaultSelected: false }, { selected: true, defaultSelected: false }], true);
  assert.equal(h.hasDraft(), true);
  h.controls[0].disabled = true; assert.equal(h.hasDraft(), false, 'disabled saved fields do not create a draft');
  h.controls[0] = new HTMLInputElement(h.forms[0], { type: 'hidden', value: 'Changed', defaultValue: 'Saved' });
  assert.equal(h.hasDraft(), false);
  h.controls[0] = new HTMLInputElement(h.forms[0], { name: '', value: 'Changed', defaultValue: 'Saved' });
  assert.equal(h.hasDraft(), false);
  h.controls[0] = new HTMLInputElement(h.forms[0], { type: 'file', files: [{}] });
  assert.equal(h.hasDraft(), true);
  h.controls[0].files = []; assert.equal(h.hasDraft(), false);
  h.unmount();
});

test('unsaved settings protect sidebar and search navigation, Escape and Keep editing preserve the draft', () => {
  const h = harness();
  assert.equal(h.link('/dashboard').defaultPrevented, false);
  h.change('Unsaved guidance');
  assert.equal(h.link('/admin?tab=team').defaultPrevented, true);
  assert.equal(h.dialog.open, true); assert.deepEqual(h.navigations, []);
  h.click('Keep editing'); assert.equal(h.dialog.open, false); assert.equal(h.active.focused, true); assert.equal(h.hasDraft(), true);
  assert.equal(h.search('/outcomes').defaultPrevented, true);
  assert.equal(h.escape().defaultPrevented, true); assert.equal(h.dialog.open, false);
  assert.equal(h.unload().defaultPrevented, true);
  h.link('/admin?tab=ai#chatgpt'); h.click('Discard and continue');
  assert.deepEqual(h.navigations, ['/admin?tab=ai#chatgpt']); assert.equal(h.dialog.open, false);
  assert.equal(h.hasDraft(), true, 'the existing draft survives until navigation actually unmounts it');
  h.change('Saved'); assert.equal(h.link('/dashboard').defaultPrevented, false); assert.equal(h.unload().defaultPrevented, false);
  h.unmount(); assert.equal(h.documentListeners.size, 0); assert.equal(h.windowListeners.size, 0); assert.equal(h.contentListeners.size, 0);
});

test('settings guard ignores modified links, new tabs, downloads, same-page anchors and action dialog buttons', () => {
  const h = harness(); h.change('Draft');
  for (const [href, options] of [['/dashboard', { metaKey: true }], ['/dashboard', { ctrlKey: true }], ['/dashboard', { shiftKey: true }], ['/dashboard', { altKey: true }], ['/dashboard', { button: 1 }], ['/dashboard', { target: '_blank' }], ['/download', { download: true }], ['https://other.example/', {}], ['#brand', {}]]) {
    assert.equal(h.link(href, options).defaultPrevented, false);
  }
  assert.equal(h.actionButton().defaultPrevented, false, 'native confirmation controls are not intercepted');
  assert.equal(h.dialog.open, false); h.unmount();
});

test('form submission remains direct, repeat submits and navigation wait, and a failed save can be retried', () => {
  const h = harness(); h.change('Draft');
  assert.equal(h.submit().defaultPrevented, false, 'the first save is not interrupted by a draft warning');
  assert.equal(h.unload().defaultPrevented, false, 'an explicit submit can finish its redirect');
  assert.equal(h.submit().defaultPrevented, true, 'a repeated submit cannot issue the same action twice');
  h.busy(true);
  assert.equal(h.link('/dashboard').defaultPrevented, true); assert.match(text(h.tree), /Settings are saving/);
  assert.equal(nodes(h.tree, n => n.type === 'button' && text(n) === 'Discard and continue').length, 0);
  h.click('Stay on this page'); assert.equal(h.search('/usage').defaultPrevented, true);
  h.busy(false); assert.equal(h.dialog.open, false);
  assert.equal(h.unload().defaultPrevented, true, 'if a save did not reset the draft, it is still protected');
  assert.equal(h.submit().defaultPrevented, false, 'save can be retried after pending finishes');
  h.busy(true); h.controls[0].defaultValue = 'Draft'; h.busy(false);
  assert.equal(h.hasDraft(), false); assert.equal(h.search('/usage').defaultPrevented, false);
  h.unmount();
});

test('GET filters are not drafts or pending saves, but protect another form’s unsaved changes', () => {
  const h = harness(), filter = new HTMLFormElement({ filter: true, method: 'get', data: [['tab', 'memory'], ['dept', 'creative']] });
  h.forms.push(filter);
  h.controls.push(new HTMLSelectElement(filter, [{ selected: false, defaultSelected: true }, { selected: true, defaultSelected: false }]));
  assert.equal(h.hasDraft(), false, 'choosing a filter is not a settings edit');
  assert.equal(h.submit(filter).defaultPrevented, false);
  assert.equal(h.submit(filter).defaultPrevented, false, 'filter submit never leaves a stuck pending marker');
  assert.equal(h.link('/dashboard').defaultPrevented, false);
  h.change('Unsubmitted lesson');
  assert.equal(h.submit(filter).defaultPrevented, true);
  assert.match(text(h.tree), /Keep your changes/); h.click('Keep editing');
  assert.equal(h.hasDraft(), true);
  h.submit(filter); h.click('Discard and continue');
  assert.deepEqual(h.navigations, ['/admin?tab=memory&dept=creative']);
  h.unmount();
});
