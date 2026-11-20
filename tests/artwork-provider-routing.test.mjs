import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseArtworkProvider} from '../src/lib/artwork/provider-routing.mjs';

test('explicit provider is honored only when ready',()=>{
  assert.equal(chooseArtworkProvider({selected:'higgsfield',chatgpt:true,higgsfield:true}).provider,'higgsfield');
  assert.equal(chooseArtworkProvider({selected:'chatgpt',chatgpt:false,higgsfield:true}).provider,null);
});
test('auto route uses verified availability before AI advice',()=>{
  assert.equal(chooseArtworkProvider({chatgpt:false,higgsfield:true,suggestion:{provider:'chatgpt',reason:'Try it'}}).provider,'higgsfield');
  assert.equal(chooseArtworkProvider({chatgpt:true,higgsfield:false,suggestion:{provider:'higgsfield',reason:'Try it'}}).provider,'chatgpt');
  assert.equal(chooseArtworkProvider({chatgpt:false,higgsfield:false}).provider,null);
});
test('AI advice is accepted when both providers are ready and policy is deterministic otherwise',()=>{
  assert.deepEqual(chooseArtworkProvider({chatgpt:true,higgsfield:true,format:'portrait',suggestion:{provider:'higgsfield',reason:'A connected layout workflow suits this brief.'}}),{provider:'higgsfield',basis:'ai',reason:'A connected layout workflow suits this brief.'});
  assert.equal(chooseArtworkProvider({chatgpt:true,higgsfield:true,format:'portrait'}).provider,'chatgpt');
  assert.equal(chooseArtworkProvider({chatgpt:true,higgsfield:true,format:'carousel_card'}).provider,'higgsfield');
});
