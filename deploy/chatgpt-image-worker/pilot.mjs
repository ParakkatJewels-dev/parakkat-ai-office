import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { runCodex, readOutput, atomicJson, verifyChatGPTLogin } from './worker-core.mjs';

// Explicit one-off pilot only. It neither polls Studio nor imports or publishes images.
const directory=path.join(process.env.CHATGPT_IMAGE_WORKER_DIRECTORY||'/work',`pilot-${randomUUID()}`);
await mkdir(directory,{recursive:true,mode:0o700});
const prompt=[
  'Validate subscription-only unattended image generation with exactly ONE call to the built-in image_gen__imagegen tool.',
  'Create a simple square photograph of a single plain gold bangle on an off-white background, soft studio lighting, no text, no logo.',
  'Use only the built-in tool. Never use an Images API, SDK, API key, image_gen.py fallback, Higgsfield, network scripts, substitute renderer, or another generation attempt. If the tool fails or is unavailable, stop.',
  'Do not use terminal commands, exec_command, shell scripts, filesystem reads or file-copy tools. The native image tool saves its PNG automatically; the supervisor collects it. After one successful generation, stop and report the tool outcome. Do not inspect secrets, upload, import, publish, or read unrelated files.',
].join('\n\n');
console.log(`Pilot workspace: ${directory}`);
try {
  await verifyChatGPTLogin({directory});
  const receipt=await runCodex({directory,prompt,sandbox:process.env.CHATGPT_IMAGE_SANDBOX||'workspace-write'});
  const output=await readOutput(directory);
  await atomicJson(path.join(directory,'proof.json'),{success:true,tool:'image_gen__imagegen',threadId:receipt.threadId,nativeFile:receipt.sourceFile,apiKeysPassed:false,createdAt:new Date().toISOString(),...output.info});
  console.log(JSON.stringify({success:true,path:path.join(directory,'output.png'),...output.info}));
} catch {
  console.error(`Pilot failed or its output could not be verified. Inspect ${path.join(directory,'run.log')}; no retry or fallback was attempted.`);
  process.exitCode=1;
}
