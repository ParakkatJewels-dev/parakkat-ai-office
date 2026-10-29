import test from 'node:test';
import assert from 'node:assert/strict';
import { permittedWorkAgents } from '../src/lib/agents/work-status-access.mjs';

const departments = [{ id:'creative', human_head_role:'creative_head' }, { id:'sales', human_head_role:'ecom_manager' }];
const agents = [{ id:'designer', department_id:'creative', enabled:true }, { id:'sales', department_id:'sales', enabled:true }, { id:'copywriter', department_id:'creative', enabled:false }];
test('current department role, not globally readable roster, determines visible work', () => {
  assert.deepEqual(permittedWorkAgents('creative_head', departments, agents), ['designer']);
  assert.deepEqual(permittedWorkAgents('ecom_manager', departments, agents), ['sales']);
  assert.deepEqual(permittedWorkAgents('viewer', departments, agents), []);
  assert.deepEqual(permittedWorkAgents('unknown', departments, agents), []);
});
test('admin sees enabled department agents; missing departments and reassignment fail closed', () => {
  assert.deepEqual(permittedWorkAgents('super_admin', departments, agents), ['designer', 'sales']);
  assert.deepEqual(permittedWorkAgents('super_admin', [], agents), []);
  assert.deepEqual(permittedWorkAgents('creative_head', departments.map(d => ({ ...d, human_head_role:'ecom_manager' })), agents), []);
});
