import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/api/agents/[id]/work/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function route({ permitted = true } = {}) {
  const calls = [];
  const rows = {
    automation_tasks: [{ id: 'workflow', title: 'Prepare posters', status: 'review', result: { summary: 'Ten posters ready' }, updated_at: '2026-11-07T07:00:00Z' }],
    agent_tasks: [{ id: 'task', thread_id: 'thread', prompt: 'Check the images\nDetails', status: 'running', created_at: '2026-11-07T07:00:00Z' }],
    reports: [], agent_events: [], automation_events: [{ task_id: 'team-task', text: 'Checked the artwork', created_at: '2026-11-07T07:00:00Z' }],
  };
  const db = { from(table) { const query = { select() { return this; }, eq(field, value) { calls.push([table, field, value]); return this; }, in(field, values) { calls.push([table, field, values]); this.related = true; return this; }, order() { return this; }, limit() { return this; }, then(resolve) { return Promise.resolve({ data: this.related ? [{ id: 'team-task', title: 'Team artwork', status: 'completed', updated_at: '2026-11-07T07:05:00Z' }] : rows[table], error: null }).then(resolve); } }; return query; } };
  const modules = { '@/lib/agents/conversation-api': {
    conversationUser: async () => ({ db, role: 'creative_head' }),
    conversationAgent: async (_session, id) => permitted ? { id } : null,
    json: (body, status = 200) => Response.json(body, { status }),
  } };
  const exports = {};
  new Function('exports', 'require', code)(exports, name => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; });
  return { GET: exports.GET, calls };
}

test('work drawer rejects an agent outside the signed-in department before reading work', async () => {
  const { GET, calls } = route({ permitted: false });
  const response = await GET(new Request('https://office.example/api/agents/other/work'), { params: Promise.resolve({ id: 'other' }) });
  assert.equal(response.status, 404);
  assert.deepEqual(calls, []);
});

test('work drawer reads only the permitted agent and returns bounded result summaries', async () => {
  const { GET, calls } = route();
  const response = await GET(new Request('https://office.example/api/agents/creativeDirector/work'), { params: Promise.resolve({ id: 'creativeDirector' }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(calls, [
    ['automation_tasks', 'owner_agent', 'creativeDirector'], ['agent_tasks', 'agent_id', 'creativeDirector'],
    ['reports', 'author_agent', 'creativeDirector'], ['agent_events', 'from_agent', 'creativeDirector'],
    ['automation_events', 'agent_id', 'creativeDirector'], ['automation_tasks', 'id', ['team-task']],
  ]);
  assert.equal(data.workflows[0].summary, 'Ten posters ready');
  assert.equal(data.conversations[0].title, 'Check the images');
  assert.equal(data.teamTasks[0].summary, 'Checked the artwork');
  assert.equal(data.workflows[0].result, undefined);
});
