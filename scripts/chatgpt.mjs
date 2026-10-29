#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const HELP = `ChatGPT connection for Parakkat AI Office (Node.js 22+)

  npm run chatgpt -- init
  npm run chatgpt -- login [--account ID | --new-account] [--port 1455] [--no-open]
  npm run chatgpt -- status
  npm run chatgpt -- accounts
  npm run chatgpt -- use ID
  npm run chatgpt -- logout [ID]
  npm run chatgpt -- resume [ID]
  npm run chatgpt -- models
  npm run chatgpt -- set-models --manager SLUG --worker SLUG
  npm run chatgpt -- verify
  npm run chatgpt -- export PATH
  npm run chatgpt -- import PATH

Set CHATGPT_AUTH_ENABLED=true to use ChatGPT for inference.
CHATGPT_AUTH_DIR selects the protected credential directory.
Reads PARAKKAT_ENV_FILE when set, otherwise .env.local if present.
Login opens a loopback callback on this computer, not the public website.
The verify command makes one small request using your ChatGPT plan.
See docs/SELF_HOST.md for transferring a connection to your VPS.
`;

export function parseArgs(argv) {
  const command = argv[0] || 'help';
  if (['help', '--help', '-h'].includes(command)) return { command: 'help', options: {}, positional: [] };
  const allowed = {
    init: [], login: ['account', 'new-account', 'port', 'no-open'], status: [], accounts: [],
    use: [], logout: [], resume: [], models: [], 'set-models': ['manager', 'worker'], verify: [], export: [], import: [],
  };
  if (!Object.hasOwn(allowed, command)) throw new Error('Unknown command. Run npm run chatgpt -- help.');
  const options = {}, positional = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (!allowed[command].includes(key) || Object.hasOwn(options, key)) throw new Error('Unknown or repeated option. Run npm run chatgpt -- help.');
    if (key === 'no-open' || key === 'new-account') options[key] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('An option is missing its value.');
      options[key] = value;
    }
  }
  const required = ['use', 'export', 'import'].includes(command) ? 1 : 0;
  const max = ['logout', 'resume'].includes(command) ? 1 : required;
  if (positional.length < required || positional.length > max) throw new Error('Incorrect number of arguments. Run npm run chatgpt -- help.');
  if (command === 'set-models' && (!options.manager || !options.worker)) throw new Error('Choose both --manager and --worker from the models command.');
  if (options.account && options['new-account']) throw new Error('Choose a saved --account or --new-account, not both.');
  if (options.port && (!/^\d+$/.test(options.port) || Number(options.port) < 1024 || Number(options.port) > 65535)) {
    throw new Error('The callback port must be a number between 1024 and 65535.');
  }
  return { command, options, positional };
}

function loadEnvironment() {
  if (typeof process.loadEnvFile !== 'function') throw new Error('Use Node.js 22 or later.');
  const path = process.env.PARAKKAT_ENV_FILE || '.env.local';
  try { process.loadEnvFile(path); } catch (error) {
    if (process.env.PARAKKAT_ENV_FILE || error.code !== 'ENOENT') throw new Error('Could not read the environment file. Check its path and permissions.');
  }
}

const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);

/** A callback must come from the precise loopback listener and carry this attempt's state. */
export function callbackMatches(req, transaction) {
  if (req.method !== 'GET' || req.headers.host !== new URL(transaction.redirectUri).host) return false;
  let url;
  try { url = new URL(req.url, transaction.redirectUri); } catch { return false; }
  if (url.origin !== new URL(transaction.redirectUri).origin || url.pathname !== '/auth/callback') return false;
  const states = url.searchParams.getAll('state');
  if (states.length !== 1) return false;
  const actual = Buffer.from(states[0]), expected = Buffer.from(transaction.state);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function openBrowser(url) {
  const [program, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
  return new Promise(resolveOpen => {
    const child = spawn(program, args, { stdio: 'ignore', detached: true, shell: false });
    child.once('error', () => resolveOpen(false));
    child.once('spawn', () => { child.unref(); resolveOpen(true); });
  });
}

export async function login(auth, options, retryOf) {
  const port = Number(options.port || 1455);
  const selected = options.account || (options['new-account'] ? undefined : (await auth.getChatGPTStatus()).activeAccountId || undefined);
  const transaction = await auth.createLogin({ accountId: selected, port, ...(retryOf ? { retryOf } : {}) });
  // Never print a retained ID token if the core's authorization hints change later.
  if (new URL(transaction.authorizationUrl).searchParams.has('id_token_hint')) throw new Error('Cannot display a sign-in URL containing a token.');
  let busy = false, timeout, settled = false;
  let finish;
  const completion = new Promise((resolveLogin, rejectLogin) => {
    finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
      server.close();
      server.closeAllConnections();
      if (error) rejectLogin(error); else resolveLogin();
    };
  });
  const cancel = () => finish(new Error('ChatGPT sign-in cancelled.'));
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (busy || !callbackMatches(req, transaction)) {
      res.writeHead(400); res.end('This is not the pending ChatGPT sign-in. Return to the sign-in window.'); return;
    }
    busy = true;
    try {
      await auth.completeLogin(transaction, new URL(req.url, transaction.redirectUri).toString());
      const status = await auth.getChatGPTStatus();
      // Let the callback response flush before closing remaining connections.
      res.once('finish', () => finish());
      res.end(status.connected ? 'ChatGPT connected. You can close this window and return to the terminal.'
        : 'Sign-in finished. ChatGPT plan permission is not enabled. Return to the terminal for the next step.');
    } catch (error) {
      res.once('finish', () => finish(error));
      res.writeHead(400); res.end('ChatGPT sign-in could not be completed. Return to the terminal and start a new sign-in.');
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.once('error', error => finish(new Error(error.code === 'EADDRINUSE'
    ? 'The callback port is in use. Retry login with --port and another free port.'
    : 'Could not start the local ChatGPT callback listener.')));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  timeout = setTimeout(() => finish(new Error('ChatGPT sign-in timed out. Run login again.')), 10 * 60_000);
  // The listener is accepting connections before the sign-in URL is opened or displayed.
  server.listen(port, '127.0.0.1', async () => {
    console.log('Continue with ChatGPT using this link on the computer receiving the loopback callback:');
    console.log(transaction.authorizationUrl);
    if (!options['no-open']) await openBrowser(transaction.authorizationUrl);
    console.log('Waiting for ChatGPT sign-in. Press Ctrl+C to cancel.');
  });
  try { await completion; } catch (error) {
    if (error.code === 'invalid_grant' && !retryOf) {
      await new Promise(resolveClose => server.close(() => resolveClose()));
      console.log('The authorization code could not be used. Starting one fresh sign-in with the same registration.');
      return login(auth, options, transaction);
    }
    throw error;
  }
  const status = await auth.getChatGPTStatus();
  if (!status.connected) {
    console.log('Sign-in is saved, but ChatGPT plan use is not enabled. Enable access in ChatGPT Settings → Usage, then sign in again with this saved account.');
    return;
  }
  console.log('ChatGPT connected. Run the models command to choose your manager and worker models.');
}

function printStatus(status) {
  console.log(`ChatGPT OAuth: ${status.enabled ? 'enabled' : 'disabled'}`);
  console.log(`Active connection: ${status.connected ? 'connected' : 'not connected'}`);
  if (status.usageBlocked) console.log('Active account inference is paused after its ChatGPT plan allowance was exhausted. Check ChatGPT Settings → Usage before running resume.');
  for (const account of status.accounts) {
    console.log(`${account.active ? '*' : ' '} ${clean(account.id)}  ${clean(account.label)}${account.email ? ` (${clean(account.email)})` : ''}  ${account.connected ? 'connected' : 'sign-in required'}${account.usageBlocked ? ' · usage paused' : ''}`);
  }
  if (!status.accounts.length) console.log('No saved accounts. Run the login command.');
  console.log(`Manager model: ${clean(status.models.manager) || 'automatic from account catalog'}`);
  console.log(`Worker model: ${clean(status.models.worker) || 'automatic from account catalog'}`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options, positional } = parseArgs(argv);
  if (command === 'help') { console.log(HELP); return; }
  loadEnvironment();
  const auth = await import('../src/lib/chatgpt/auth.mjs');
  if (command === 'init') { await auth.ensureHost(); console.log('This host is initialized. Its identifier is retained across restarts and credential imports.'); return; }
  if (command === 'login') { await login(auth, options); return; }
  if (command === 'status' || command === 'accounts') { printStatus(await auth.getChatGPTStatus()); return; }
  if (command === 'use') { await auth.selectAccount(positional[0]); printStatus(await auth.getChatGPTStatus()); return; }
  if (command === 'logout') {
    const { revoked } = await auth.disconnectAccount(positional[0]);
    console.log(revoked ? 'Disconnected and the renewable session was revoked.'
      : 'Disconnected locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings.');
    return;
  }
  if (command === 'export') { await auth.exportCredentials(resolve(positional[0])); console.log('The active connection was exported to a protected file. Transfer it over SSH and delete the transfer file afterward.'); return; }
  if (command === 'import') { await auth.importCredentials(resolve(positional[0])); console.log('Connection imported. This server keeps its own host identifier and now owns token renewal.'); return; }
  const inference = await import('../src/lib/llm/chatgpt.mjs');
  if (command === 'resume') {
    const accountId = positional[0] || (await auth.getChatGPTStatus()).activeAccountId;
    if (!accountId) throw new Error('Connect and select a ChatGPT account first.');
    await inference.resumeChatGPTUsage(accountId);
    console.log('The account’s local usage pause is cleared. Make sure ChatGPT Settings → Usage allows requests before resuming agent work.');
    return;
  }
  if (command === 'models' || command === 'set-models') {
    const accountId = (await auth.getChatGPTStatus()).activeAccountId;
    if (!accountId) throw new Error('Connect and select a ChatGPT account first.');
    const models = await inference.listChatGPTModels(accountId);
    if (command === 'models') {
      for (const model of models) console.log(`${clean(model.slug)}\t${clean(model.display_name)}`);
      console.log('These are the current account catalog entries. The verify command checks inference access.');
      return;
    }
    if (![options.manager, options.worker].every(slug => models.some(model => model.slug === slug))) {
      throw new Error('Choose manager and worker model slugs from this account’s models command.');
    }
    await auth.setModels({ manager: options.manager, worker: options.worker }, accountId);
    console.log('Manager and worker models saved for the active account.');
    return;
  }
  if (command === 'verify') {
    const result = await inference.chatGPTJSON('worker', 'Reply with exactly one JSON object containing the key connected with the boolean value true.', 'Confirm the connection.');
    if (result.value?.connected !== true) throw new Error('Inference finished but the connection check returned an unexpected result.');
    console.log(`ChatGPT inference verified with ${clean(result.model)}. This request used your ChatGPT plan.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`ChatGPT: ${clean(error.message) || 'Command failed.'}`); process.exitCode = 1; });
}
