import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/components/AgentConversation.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
const nodes = (tree, predicate) => !tree ? [] : Array.isArray(tree) ? tree.flatMap(child => nodes(child, predicate)) : typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const id = '11111111-1111-4111-8111-111111111111', carousel = '22222222-2222-4222-8222-222222222222';
const message = (messageId, metadata) => ({ id: messageId, role: 'assistant', content: `Message ${messageId}`, created_at: '2026-10-28T10:00:00Z', metadata });
const artwork = (changes = {}) => ({ id, title: 'Fine chain', status: 'awaiting_import', requestId: 'request-1', imported: false, importProvider: null, imageUrl: null, version: null, carouselId: null, carouselIndex: null, needsAttention: false, ...changes });

function render(messages, artworks) {
  let stateIndex = 0;
  const react = {
    useId: () => 'test', useEffect() {}, useCallback: fn => fn, useRef: initial => ({ current: initial }),
    useState: initial => [stateIndex++ === 0 ? { threads: [], thread: null, messages, artworks, meetings: [], canSend: true } : initial === true ? false : initial, () => {}],
  };
  const modules = {
    react, 'react/jsx-runtime': jsx, 'next/link': { default: 'a' }, '@/components/Icon': { Icon: 'icon' },
    '@/lib/agents/conversation-request.mjs': { prepareConversationRequest() { throw new Error('No send in a rendering check'); } },
    './AgentConversation.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
    '@/app/(app)/studio/ChatGPTArtwork': { ChatGPTArtwork: 'ChatGPTArtwork' },
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, name => { assert.ok(name in modules, `Unmocked import ${name}`); return modules[name]; });
  return exports.default({ agentId: 'headCreative', agentName: 'Creative head' });
}

test('the latest linked answer owns one inline handoff and a new request changes the component key', () => {
  const messages = [message('contribution', { design_id: id }), message('answer', { design_id: id })];
  const tree = render(messages, [artwork()]);
  const handoffs = nodes(tree, node => node.type === 'ChatGPTArtwork');
  assert.equal(handoffs.length, 1);
  assert.deepEqual(handoffs[0].props, { source: 'design', id, requestId: 'request-1', title: 'Fine chain', status: 'awaiting_import', initialProvider: 'higgsfield', compact: true });
  const owners = nodes(tree, node => node.type === 'li' && nodes(node, child => child.type === 'ChatGPTArtwork').length > 0);
  assert.equal(owners.length, 1); assert.match(text(owners[0]), /Message answer/);
  const next = nodes(render(messages, [artwork({ requestId: 'request-2' })]), node => node.type === 'ChatGPTArtwork')[0];
  assert.notEqual(next.key, handoffs[0].key, 'revision resets cached brief, file and upload success');
});

test('imported images replace handoff controls and require human review without claiming AI quality approval', () => {
  const tree = render([message('answer', { design_id: id })], [artwork({ status: 'ready', imageUrl: 'https://office.example/signed.png', version: 2, imported: true, importProvider: 'ChatGPT' })]);
  assert.equal(nodes(tree, node => node.type === 'ChatGPTArtwork').length, 0);
  const images = nodes(tree, node => node.type === 'img');
  assert.equal(images.length, 1); assert.equal(images[0].props.src, 'https://office.example/signed.png');
  assert.match(text(tree), /Imported from ChatGPT. Human visual review is still required/);
  assert.doesNotMatch(text(tree), /product match passed|AI.checked/i);
});

test('carousel cards attach to the saved set and unlinked rows cannot appear in a conversation', () => {
  const tree = render([message('answer', { carousel_id: carousel })], [artwork({ carouselId: carousel, carouselIndex: 2 }), artwork({ id: carousel, imageUrl: 'https://office.example/unlinked.png' })]);
  assert.match(text(tree), /Card 2: Fine chain/);
  assert.equal(nodes(tree, node => node.type === 'ChatGPTArtwork').length, 1);
  assert.equal(nodes(tree, node => node.type === 'img').length, 0);
});

test('a Higgsfield import is labeled with its provider rather than ChatGPT', () => {
  const tree = render([message('answer', { design_id: id })], [artwork({ status: 'ready', imageUrl: 'https://office.example/higgsfield.png', imported: true, importProvider: 'Higgsfield' })]);
  assert.match(text(tree), /Imported from Higgsfield. Human visual review is still required/);
  assert.doesNotMatch(text(tree), /Imported from ChatGPT/);
  assert.equal(nodes(tree, node => node.type === 'ChatGPTArtwork').length, 0);
});

test('active generation uses the shared status controls and completed output retains human review', () => {
  const messages=[message('answer',{design_id:id})];
  const pending=render(messages,[artwork({status:'generating',imageUrl:'https://office.example/previous.png'})]);
  assert.equal(nodes(pending,n=>n.type==='ChatGPTArtwork')[0].props.status,'generating');
  assert.equal(nodes(pending,n=>n.type==='img')[0].props.src,'https://office.example/previous.png');
  const complete=render(messages,[artwork({status:'ready',generatedProvider:'Higgsfield',imageUrl:'https://office.example/generated.png'})]);
  assert.equal(nodes(complete,n=>n.type==='ChatGPTArtwork').length,0);
  assert.match(text(complete),/Generated with Higgsfield. Human visual review is required/);
  assert.doesNotMatch(text(complete),/Imported from|AI.checked/);
});

test('a pending revision of a ChatGPT import passes the saved provider to its controls',()=>{
  const pending=render([message('answer',{design_id:id})],[artwork({imported:true,importProvider:'ChatGPT'})]);
  assert.equal(nodes(pending,n=>n.type==='ChatGPTArtwork')[0].props.initialProvider,'chatgpt');
});
