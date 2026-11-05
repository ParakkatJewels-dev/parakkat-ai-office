// Local-only visual harness for the 3D office. Runs the real engine with fixtures, without a login, a database or any provider.
// Deliberately serves an allowlist, never the project or its env files.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = new Map([
  ['/styles.css', 'src/app/globals.css'],
  ['/office.css', 'src/app/office.css'],
  ['/lib/agents/activity-core.mjs', 'src/lib/agents/activity-core.mjs'],
  ...['engine', 'floorplan', 'walk', 'building', 'crowd', 'roster', 'direct-dialogue', 'work-status', 'character-motion', 'map-input', 'agent-hq'].map(n => [`/${n}.mjs`, `src/office/${n}.mjs`]),
  ['/three.mjs', 'node_modules/three/build/three.module.js'],
  ['/OrbitControls.mjs', 'node_modules/three/examples/jsm/controls/OrbitControls.js'],
]);
const page = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Office preview</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/office.css"><style>html,body{height:100%;margin:0;overflow:hidden}.om{height:100vh}.panel{position:absolute;left:12px;top:12px;z-index:9;display:flex;flex-wrap:wrap;gap:6px;max-width:80vw;font:12px monospace}.panel button{padding:6px 10px;background:#17161a;color:#fff;border:1px solid #444;border-radius:6px}#status{position:absolute;left:12px;bottom:12px;z-index:9;color:#ffd338;font:12px monospace;background:#000a;padding:4px 8px}</style>
<script type="importmap">{"imports":{"three":"/three.mjs"}}</script></head><body><section class="om"><div class="world" id="world"><canvas id="canvas"></canvas><div id="labels"></div></div></section>
<div class="panel"><button id="over">Overview</button><button id="top">Top</button><button id="walk">Walk in</button><button id="work">8 working</button><button id="meet">Meeting</button><button id="end">End meeting</button><button id="visit">Desk visit</button></div><div id="status"></div>
<script type="module">
import * as THREE from 'three'; import {OrbitControls} from '/OrbitControls.mjs'; import {createOffice} from '/engine.mjs'; import * as roster from '/roster.mjs';
const log=[];const office=createOffice({THREE,OrbitControls,canvas:document.querySelector('#canvas'),host:document.querySelector('#world'),labels:document.querySelector('#labels'),roster,fill:true,
  onMode:m=>log.push('mode:'+m),onArea:a=>log.push('area:'+(a?a.id:'none')),onPrompt:p=>{window.prompted=p;if(p)log.push('prompt:'+p.text)},onTalk:p=>log.push('talk:'+p.id),onMenu:o=>log.push('menu:'+o),onSelect:p=>log.push('select:'+p.id)});
window.office=office;window.officeLog=log;window.THREE=THREE;
const q=id=>document.querySelector(id);
q('#over').onclick=()=>{office.exitWalk();office.setView('3d')};q('#top').onclick=()=>office.setView('2d');q('#walk').onclick=()=>office.enterWalk();
const workers=roster.PEOPLE.filter(p=>!p.human).slice(0,8).map(p=>p.id);
q('#work').onclick=()=>office.setWorkStatuses(Object.fromEntries(workers.map((id,i)=>[id,{state:'working',label:'Local preview: reviewing evidence '+(i+1),expiresAt:Date.now()+120000}])));
const meeting={id:'local-meeting',status:'running',title:'Onam campaign kickoff',participants:['cmo','copywriter','sales','metaSpec','designer'],speakerId:'cmo'};
q('#meet').onclick=()=>{office.setMeeting(meeting);office.focusMeeting()};q('#end').onclick=()=>office.setMeeting({...meeting,status:'completed'});
q('#visit').onclick=()=>void office.directDialogue({id:'v'+Date.now(),visitorId:'cmo',recipientId:'sales',speakerId:'cmo',text:'Local preview: how far along is the report?',phase:'single',createdAt:Date.now(),onState(){}});
office.setBoard({status:'LIVE · PREVIEW',columns:[{title:'Working now',count:2,items:['Sales Analyst: pulling GA4 results','Copywriter: Onam headlines']},{title:'Waiting on people',count:1,items:['Onam plan needs the Creative Head']},{title:'Latest',count:2,items:['Competitor Scout filed a report','Budget Guard checked pacing']}]});
addEventListener('resize',()=>office.resize());
setInterval(()=>{const i=office.info();q('#status').textContent=i.calls+' draws · '+Math.round(i.tris/1000)+'k tris · quality '+i.quality+' · '+office.mode},1000);
</script></body></html>`;
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); return; }
  const file = files.get(path);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try { const data = await readFile(new URL(file, root)); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Office visual preview: http://127.0.0.1:4173'));
