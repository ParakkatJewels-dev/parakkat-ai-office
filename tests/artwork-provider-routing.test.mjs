import test from 'node:test';
import assert from 'node:assert/strict';
import {revisionArtworkProvider,requestedArtworkProvider,chatGPTRevisionMessage} from '../src/lib/artwork/provider-routing.mjs';

test('revision defaults use saved provenance while explicit overrides stay validated',()=>{
  assert.equal(revisionArtworkProvider(null,'chatgpt_import'),'chatgpt');
  for(const origin of [null,'gemini','higgsfield_import','higgsfield_oauth'])assert.equal(revisionArtworkProvider('',origin),'higgsfield');
  assert.equal(revisionArtworkProvider('higgsfield','chatgpt_import'),'higgsfield');
  assert.equal(revisionArtworkProvider('chatgpt','higgsfield_oauth'),'chatgpt');
  for(const value of ['openai','false',{},1])assert.throws(()=>revisionArtworkProvider(value,'chatgpt_import'),/Choose ChatGPT or Higgsfield/);
});

test('explicit chat provider directions respect negation without paying for a forbidden Higgsfield route',()=>{
  for(const text of ['Redesign this image using ChatGPT','Use ChatGPT instead of Higgsfield','Use ChatGPT, not Higgsfield',"Don't use Higgsfield for this revision",'Redesign with ChatGPT rather than Higgsfield'])assert.equal(requestedArtworkProvider(text),'chatgpt',text);
  for(const text of ['Redesign this poster with Higgsfield',"Do not use ChatGPT; use Higgsfield"])assert.equal(requestedArtworkProvider(text),'higgsfield',text);
  assert.equal(requestedArtworkProvider('Redesign this poster with blue lighting'),null);
  assert.equal(requestedArtworkProvider('Compare ChatGPT and Higgsfield quality for this poster'),null);
  assert.match(chatGPTRevisionMessage(5),/ChatGPT briefs prepared for 5 images/);
  assert.match(chatGPTRevisionMessage(1),/does not generate ChatGPT images automatically/);
});
