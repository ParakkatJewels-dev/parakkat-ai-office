import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const jsx = require('react/jsx-runtime');
let pathname = '/dashboard';
const code = ts.transpileModule(readFileSync(new URL('../src/components/WorkspaceFrame.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
new Function('exports', 'require', code)(exports, name => {
  if (name === 'react/jsx-runtime') return jsx;
  if (name === 'next/navigation') return { usePathname: () => pathname };
  throw new Error(`Unexpected import: ${name}`);
});

test('office and nested office routes retain their original frame through navigation', () => {
  const children = { savedWorkspace: true };
  for (const route of ['/dashboard', '/office', '/office/rooms', '/studio', '/agents/manage', '/office']) {
    pathname = route;
    const rendered = exports.WorkspaceFrame({ children });
    assert.equal(rendered.type, 'div');
    assert.equal(rendered.props.className, route === '/office' || route.startsWith('/office/') ? 'shell' : 'shell workspace');
    assert.equal(rendered.props.children, children);
  }
});
