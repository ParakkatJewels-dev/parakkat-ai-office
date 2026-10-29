import { readFile, stat } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi, createWorker } from './worker-core.mjs';

/** Supervisor-only entrypoint. No model request is made when the queue is empty. */
export async function main(env=process.env) {
  const secretPath=env.CHATGPT_IMAGE_WORKER_SECRET_FILE;
  if(!secretPath)throw new Error('Set the supervisor-only CHATGPT_IMAGE_WORKER_SECRET_FILE.');
  const secretInfo=await stat(secretPath);
  if(!secretInfo.isFile()||(secretInfo.mode&0o077)!==0)throw new Error('The worker credential file must be private.');
  const secret=(await readFile(secretPath,'utf8')).trim();
  const root=env.CHATGPT_IMAGE_WORKER_DIRECTORY||'/work';
  const owner={uid:Number(env.CHATGPT_IMAGE_CODEX_UID||1000),gid:Number(env.CHATGPT_IMAGE_CODEX_GID||1000)};
  if(process.getuid?.()!==0||!Number.isInteger(owner.uid)||owner.uid<1||!Number.isInteger(owner.gid)||owner.gid<1||secretInfo.uid!==0)throw new Error('Run the supervisor as root with a root-owned credential file and an unprivileged Codex child.');
  const interval=Number(env.CHATGPT_IMAGE_POLL_SECONDS||900)*1000;
  if(!Number.isFinite(interval)||interval<30_000||interval>24*60*60_000)throw new Error('Invalid polling interval.');
  const api=createApi({url:env.CHATGPT_IMAGE_WORKER_URL,secret});
  const log=message=>console.log(`${new Date().toISOString()} ${message}`);
  const worker=createWorker({root,api,owner,childEnv:{...env,HOME:'/home/node'},sandbox:env.CHATGPT_IMAGE_SANDBOX||'workspace-write',log});
  let stopped=false;
  // Let a dispatched generation finish and persist its output before exiting.
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;});
  log('ChatGPT image worker started. One image at a time; no paid fallback.');
  while(!stopped) {
    let completed=false;
    try {const result=await worker.tick();completed=result.result==='completed';log(`Image queue: ${result.result}${result.jobId?` (${result.jobId})`:''}.`);}
    catch {log('Image queue check failed. Existing generation state has been retained.');}
    if(env.CHATGPT_IMAGE_WORKER_ONCE==='true'||stopped)break;
    // Drain already-saved work sequentially; idle polling does not invoke a model.
    if(completed)continue;
    // Short waits let shutdown interrupt polling without interrupting image submission.
    for(let remaining=interval;remaining>0&&!stopped;remaining-=Math.min(remaining,1000))await sleep(Math.min(remaining,1000));
  }
}

if(import.meta.url===`file://${process.argv[1]}`)main().catch(()=>{console.error('Image worker startup failed. Check its private configuration and login.');process.exitCode=1;});
