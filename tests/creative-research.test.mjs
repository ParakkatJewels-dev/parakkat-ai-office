import test from 'node:test';
import assert from 'node:assert/strict';
import {creativeResearchResult,creativeResearchBrief,searchResultLinks} from '../src/lib/agents/creative-research-core.mjs';

test('grounded research carries dated source links into the creative brief',()=>{
  const result=creativeResearchResult({candidates:[{content:{parts:[{text:'{"layout":"clean editorial grid","palette":"warm ivory","typography":"serif title","imagery":"soft light","customerHook":"gift moment"}'}]},groundingMetadata:{groundingChunks:[{web:{title:'Pinterest design',uri:'https://www.pinterest.com/pin/123'}}]}}]},'2026-11-02T10:00:00Z');
  assert.ok(result);
  assert.match(creativeResearchBrief(result),/clean editorial grid/);
  assert.match(creativeResearchBrief(result),/https:\/\/www.pinterest.com\/pin\/123/);
  assert.equal(creativeResearchResult({candidates:[{content:{parts:[{text:'{"layout":"grid","palette":"ivory","typography":"serif"}'}]}}]},'now'),null);
});

test('public search results preserve original links and snippets',()=>{
  const html=`<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.pinterest.com%2Fpin%2F123&amp;rut=abc" class='result-link'>Jewellery <b>poster</b> ideas</a><td class='result-snippet'>Warm <b>ivory</b> editorial layout</td>`;
  assert.deepEqual(searchResultLinks(html),[{title:'Jewellery poster ideas',url:'https://www.pinterest.com/pin/123',snippet:'Warm ivory editorial layout'}]);
});
