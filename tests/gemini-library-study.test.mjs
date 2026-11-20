import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/llm/gemini.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

test('Drive design study can inspect an image while Gemini artwork remains disabled', async () => {
  const calls = [];
  const modules = {
    'server-only': {}, 'node:crypto': { createHash },
    '@/lib/env': { opt: (_name, fallback) => fallback },
    '@/lib/usage': { recordUsage: async () => {} },
    '@/lib/usage-cost.mjs': { geminiImageBilling: () => ({}) },
    '@/lib/pause': { checkPause: async () => {} },
    './gemini-config': { getGeminiConfig: async () => ({ apiKey: 'test-key', imageModel: 'image-model' }), recordGeminiImageResult: async () => {} },
    './gemini-core.mjs': {
      GeminiError: class extends Error {},
      geminiImage: () => { throw new Error('Image generation must stay disabled.'); },
      geminiImageGenerationConfig: () => ({}),
      geminiRequest: async request => { calls.push(request); return { candidates: [{ content: { parts: [{ text: '{"keep":true}' }] } }] }; },
    },
    '@/lib/agents/agent-instructions': { agentPrompt: async () => 'Library study' },
    '@/lib/agents/agent-instructions-core.mjs': { agentPromptId: () => 'designer' },
    '@/lib/agents/agent-work': { withModelWork: (_system, _options, work) => work() },
    '@/lib/ai-budget': { runAiBudgetedText: (_options, work) => work({ signal: AbortSignal.timeout(1000), maxOutputTokens: 1000, reportUsage: () => {} }), runAiBudgetedImage: work => work() },
    '@/lib/artwork-mode.mjs': { isChatGPTHandoff: () => true },
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; });
  const agent = { db: {}, id: 'designer' };
  await assert.rejects(exports.geminiJSON('Inspect this design', [], agent), /artwork calls are disabled/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await exports.geminiJSON('Inspect this design', [{ inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } }], agent, 'library_study'), { keep: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
  await assert.rejects(exports.generateGeminiTestImage(), /artwork calls are disabled/);
  assert.equal(calls.length, 1);
});
