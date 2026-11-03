import test from 'node:test';
import assert from 'node:assert/strict';
import {taskIntakeKind,taskIntakeHead,taskIntakeFallback} from '../src/lib/agents/task-intake-core.mjs';

const heads=[
  {id:'cmo',name:'AI Chief Marketing Officer',department_id:'board'},
  {id:'analyticsLead',name:'Analytics Lead',department_id:'insights'},
  {id:'creativeDirector',name:'Creative Director AI',department_id:'creative'},
  {id:'seoLead',name:'SEO Lead',department_id:'seo'},
];

test('the intake separates questions, actual image requests and reviewed work',()=>{
  assert.equal(taskIntakeKind('What were Shopify sales last week?'),'conversation');
  assert.equal(taskIntakeKind('Find the top selling chain and create 3 posters'),'image');
  assert.equal(taskIntakeKind('Create three product designs using these Shopify links'),'image');
  assert.equal(taskIntakeKind('Prepare an SEO content audit'),'head_task');
  assert.equal(taskIntakeKind('What are sales?', 'work'),'head_task');
  assert.equal(taskIntakeKind('Prepare a report','chat'),'conversation');
});

test('only accessible heads can be selected, with a role-specific fallback',()=>{
  assert.equal(taskIntakeHead('Review SEO keywords',heads),'seoLead');
  assert.equal(taskIntakeHead('Review SEO keywords',heads,'creativeDirector'),'creativeDirector');
  assert.equal(taskIntakeHead('Review SEO keywords',heads,'hiddenAgent'),'seoLead');
  assert.equal(taskIntakeHead('Find top selling chains and make posters',heads),null,'cross-department request is resolved by the image route');
  assert.equal(taskIntakeFallback(heads,'super_admin'),'cmo');
  assert.equal(taskIntakeFallback(heads.filter(head=>head.id!=='cmo'),'creative_head'),'creativeDirector');
});
