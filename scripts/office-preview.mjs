// Local-only visual harness. Deliberately serves an allowlist, never the project or its env files.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = new Map([
  ['/styles.css', 'src/app/globals.css'],
  ['/lib/agents/activity-core.mjs', 'src/lib/agents/activity-core.mjs'],
  ['/office/foliage-cluster.png', 'public/office/foliage-cluster.png'],
  ...['engine', 'world', 'roster', 'landscape', 'materials', 'meeting-paths', 'direct-dialogue', 'work-status'].map(n => [`/${n}.mjs`, `src/office/${n}.mjs`]),
  ['/three.mjs', 'node_modules/three/build/three.module.js'],
  ['/OrbitControls.mjs', 'node_modules/three/examples/jsm/controls/OrbitControls.js'],
]);
const page = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Parakkat • Office map preview</title><link rel="stylesheet" href="/styles.css"><style>
.rail[hidden]{display:none}:root{--f-body:Arial,sans-serif;--f-display:Arial,sans-serif;--f-data:monospace}body{margin:0} .preview-status{position:absolute;left:16px;top:16px;padding:8px 12px;background:#0b1b20dd;color:#e5e5df;border-radius:8px;font-size:11px;z-index:5} .preview-sky{position:absolute;left:16px;bottom:80px;display:flex;gap:6px;z-index:5}.preview-sky button{border:1px solid #34464b;background:#102228;color:#e5e5df;padding:7px;border-radius:6px}.preview-nav{font-size:14px}.preview-nav .nav{opacity:.8}.preview-nav .nav:first-child{color:#5eead4;background:#12403d}.preview-top{letter-spacing:.2em;font:24px Georgia;color:#eee}.preview-top small{font:9px Arial;display:block;letter-spacing:.2em;margin-top:4px}.preview-pane{font-size:13px;line-height:1.7}.preview-pane p{color:#a3b6bb;margin:8px 0}
</style><script type="importmap">{"imports":{"three":"/three.mjs"}}</script></head><body><div class="shell"><header class="topbar"><div class="preview-top">PARAKKAT<small>JEWELS | MARKETING HQ</small></div><div class="search" style="margin-left:32px;padding:14px;color:#9cadb2">Search rooms, people, or departments…</div><span style="margin-left:auto;font-size:12px;color:#8aa5a8">LOCAL VISUAL PREVIEW</span></header><aside class="side preview-nav"><div class="nav">Office Map</div><div class="nav">Dashboard</div><div class="nav">Departments</div><div class="nav">AI Studio</div><div class="nav">Approvals</div><div class="nav">Admin</div><div class="loc">Parakkat HQ<br>Alappuzha, Kerala</div></aside><main class="main"><section class="om"><div class="world" id="world"><canvas id="canvas" aria-label="Interactive 3D office map"></canvas><div id="labels"></div><output id="status" class="preview-status">Building campus…</output><aside class="rail float"><div class="pane preview-pane"><h3>Office Map</h3><p>Live 3D architectural preview</p><div id="campus-count"></div><p>Drag to explore the campus.<br>Right-drag to rotate.<br>Scroll to zoom.</p></div><div class="pane preview-pane"><h3>Material & light study</h3><p>Landscaped grounds<br>Glazed workspaces<br>Stone and warm oak finishes</p></div></aside><div class="preview-sky"><button data-time="6.6">Sunrise</button><button data-time="12.5">Midday</button><button data-time="17.7">Golden hour</button><button data-time="20.5">Night</button></div><div class="dock float"><button id="reset"><span>Whole Campus</span></button><button data-focus="hq"><span>Marketing HQ</span></button><button data-focus="ic"><span>Intelligence Centre</span></button><button data-focus="ch"><span>Creative House</span></button></div><div class="mapctl float"><div class="seg"><button id="view2">2D</button><button id="view3" aria-pressed="true">3D</button></div><div class="seg"><button id="out" aria-label="Zoom out">−</button><button id="in" aria-label="Zoom in">+</button></div><button class="sq" id="panel" aria-label="Toggle side panel">☰</button></div></div></section></main></div><script type="module">
import * as THREE from 'three'; import {OrbitControls} from '/OrbitControls.mjs'; import {createOffice} from '/engine.mjs'; import * as roster from '/roster.mjs';
const status = document.querySelector('#status');
try { const office = createOffice({THREE,OrbitControls,canvas:document.querySelector('#canvas'),host:document.querySelector('#world'),labels:document.querySelector('#labels'),roster,fill:true,avoid:()=>[...document.querySelectorAll('.float')]});
office.setInset(336); office.setTime(17.7); let panel=true;
document.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>office.setTime(Number(b.dataset.time)));
document.querySelectorAll('[data-focus]').forEach(b=>b.onclick=()=>office.flyTo(b.dataset.focus));
document.querySelector('#reset').onclick=()=>office.flyTo(null); document.querySelector('#out').onclick=()=>office.zoom(1.2); document.querySelector('#in').onclick=()=>office.zoom(.8);
for(const v of ['2','3'])document.querySelector('#view'+v).onclick=()=>{office.setView(v+'d');document.querySelector('#view2').setAttribute('aria-pressed',String(v==='2'));document.querySelector('#view3').setAttribute('aria-pressed',String(v==='3'));};
document.querySelector('#panel').onclick=()=>{panel=!panel;document.querySelector('.rail').hidden=!panel;office.setInset(panel?336:0)};
document.querySelector('#campus-count').textContent=roster.BUILDINGS.length+' buildings · '+roster.ROOMS.length+' rooms';
// Local fixture only: exercise gathering, repeated polling and return-home without a provider or database.
const previewMeeting={id:'local-preview-meeting',status:'running',title:'Local meeting preview',participants:['cmo','copywriter','sales','metaSpec'],speakerId:'cmo'};
const meetingDemo=document.createElement('button');meetingDemo.textContent='Preview meeting';document.querySelector('.preview-sky').appendChild(meetingDemo);
const meetingEnd=document.createElement('button');meetingEnd.textContent='End preview meeting';document.querySelector('.preview-sky').appendChild(meetingEnd);
const meetingInfo=document.createElement('p');meetingInfo.setAttribute('role','status');document.querySelector('.preview-pane').appendChild(meetingInfo);
let previewActive=false;
meetingDemo.onclick=()=>{previewActive=true;office.setMeeting(previewMeeting);office.focusMeeting()};
meetingEnd.onclick=()=>{previewActive=false;office.setMeeting({...previewMeeting,status:'completed'})};
setInterval(()=>{if(previewActive)office.setMeeting(previewMeeting);const attendees=previewMeeting.participants.map(id=>office.byId[id]);meetingInfo.textContent=previewActive?'Meeting preview: '+attendees.filter(p=>p.meetingId&&p.sitting).length+' / '+attendees.length+' seated':'Meeting preview: '+attendees.filter(p=>!p.meetingId&&p.sitting).length+' / '+attendees.length+' back at desks'},1000);
// Local fixtures only; these controls never call providers, authentication or the database.
const visitPane=document.createElement('div');visitPane.className='pane preview-pane';document.querySelector('.rail').appendChild(visitPane);
const visitHeading=document.createElement('h3');visitHeading.textContent='Local desk-visit test';visitPane.appendChild(visitHeading);
const visitNote=document.createElement('p');visitNote.textContent='Preview dialogue only. CMO visits Sales Analyst; a real request waits for the reply button. Existing Preview meeting preempts these agents.';visitPane.appendChild(visitNote);
const visitControls=document.createElement('div');visitControls.style.cssText='display:flex;flex-wrap:wrap;gap:6px';visitPane.appendChild(visitControls);
const visitInfo=document.createElement('output');visitInfo.id='desk-visit-status';visitInfo.setAttribute('role','status');visitInfo.style.cssText='display:block;white-space:pre-line;font:10px/1.5 monospace;margin-top:10px';visitPane.appendChild(visitInfo);
let visitId=null, visitNumber=0, visitState='none', queuedState='none';
const testButton=(id,label,fn)=>{const b=document.createElement('button');b.id=id;b.textContent=label;b.onclick=fn;visitControls.appendChild(b);return b};
const fixture=(phase,speakerId,text)=>({id:visitId,visitorId:'cmo',recipientId:'sales',speakerId,text,phase,createdAt:Date.now(),onState:s=>{visitState=s}});
testButton('preview-desk-visit','Preview desk visit',()=>{if(visitId)office.cancelDialogue(visitId);visitId='local-desk-'+(++visitNumber);void office.directDialogue(fixture('request','cmo','Local preview request: please review the latest sales report.'));});
testButton('preview-desk-reply','Preview reply',()=>{if(visitId)void office.directDialogue(fixture('response','sales','Local preview reply: the report is ready for your review. This is fixture text, not a live agent result.'));});
testButton('preview-desk-queue','Queue shared recipient',()=>{void office.directDialogue({id:'local-queued-'+(++visitNumber),visitorId:'copywriter',recipientId:'sales',speakerId:'copywriter',text:'Local preview: this visitor waits until the Sales Analyst is free.',phase:'single',createdAt:Date.now(),onState:s=>{queuedState=s}});});
testButton('preview-desk-locate','Locate recipient',()=>office.locateDialogue('sales'));
testButton('preview-unrelated-meeting','Unrelated meeting',()=>{previewActive=false;office.setMeeting({id:'local-unrelated-meeting',status:'running',title:'Unrelated preview meeting',participants:['seoLead','metaSpec']});});
testButton('preview-meeting-speech','Preview table speech',()=>{void office.say('metaSpec','Local preview: this is a real table-speech animation fixture.');});
const describe=id=>{const p=office.byId[id];return id+': room='+p.room.id+' x='+p.x.toFixed(1)+' z='+p.z.toFixed(1)+' home='+String(Math.hypot(p.x-p.home.x,p.z-p.home.z)<.05)+' sitting='+p.sitting+' path='+p.path.length+' meeting='+(p.meetingId||'none')+' visit='+(p.visitId||'none')+' status='+p.status+' bubble='+(p.bubble||'none')};
setInterval(()=>{visitInfo.textContent=['Visit: '+visitState+' | shared queue: '+queuedState,describe('cmo'),describe('sales'),describe('copywriter'),'Selected: '+(office.selected?.id||'none')].join(String.fromCharCode(10));},500);
const workPane=document.createElement('div');workPane.className='pane preview-pane';document.querySelector('.rail').prepend(workPane);
const workHeading=document.createElement('h3');workHeading.textContent='Local working-status test';workPane.appendChild(workHeading);
const workNote=document.createElement('p');workNote.textContent='Fixture status only. No provider calls. The preview can show more than four agents working, and work remains after a short speech ends.';workPane.appendChild(workNote);
const workControls=document.createElement('div');workControls.style.cssText='display:flex;flex-wrap:wrap;gap:6px';workPane.appendChild(workControls);
const workInfo=document.createElement('output');workInfo.id='work-status-preview';workInfo.setAttribute('role','status');workInfo.style.cssText='display:block;font:11px/1.4 monospace;margin-top:8px';workPane.appendChild(workInfo);
const workIds=roster.PEOPLE.filter(p=>!p.human).slice(0,8).map(p=>p.id);let workExpires=0;
const workButton=(id,label,fn)=>{const b=document.createElement('button');b.id=id;b.textContent=label;b.onclick=fn;workControls.appendChild(b)};
const previewWork=ms=>{workExpires=Date.now()+ms;office.setWorkStatuses(Object.fromEntries(workIds.map((id,i)=>[id,{state:'working',label:'Local preview: reviewing evidence '+(i+1),expiresAt:workExpires}])));};
workButton('preview-work-eight','Preview 8 working',()=>{previewWork(120000);office.flyTo(null)});
workButton('preview-work-expire','Expire after 5 seconds',()=>previewWork(5000));
workButton('preview-work-speech','Short speech, keep work',()=>{previewWork(120000);void office.say(workIds[0],'Local preview: this speech ends; current work stays visible.','talking',1000);});
workButton('preview-work-clear','Clear work snapshot',()=>{workExpires=0;office.setWorkStatuses({});});
setInterval(()=>{const current=office.stats();const visible=[...document.querySelectorAll('.agent-work:not([hidden])')];workInfo.textContent='Working now: '+current.active+' | visible status cards: '+visible.length+' | compact: '+visible.filter(el=>el.classList.contains('compact')).length+' | fixture lease: '+(workExpires>Date.now()?Math.ceil((workExpires-Date.now())/1000)+'s':'expired/clear')+' | selected: '+(office.selected?.id||'none');},500);
addEventListener('resize',()=>office.resize()); setInterval(()=>{const i=office.info();status.textContent=i.calls+' draws · '+Math.round(i.tris/1000)+'k triangles · quality '+i.quality},2000);
}catch(error){status.textContent='Render failed: '+error.message;console.error(error)}
</script></body></html>`;
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); return; }
  const file = files.get(path);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try { const data = await readFile(new URL(file, root)); res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/javascript'); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173,'127.0.0.1',()=>console.log('Office visual preview: http://127.0.0.1:4173'));
