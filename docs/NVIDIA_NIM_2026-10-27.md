# NVIDIA NIM text fallback — 27 October 2026

The connected ChatGPT account can reach its separate plan usage limit even when AI Office has remaining daily and weekly text allowance. AI Office now accepts a verified NVIDIA API Catalog key for hosted NIM text requests. The default model is `nvidia/nemotron-3.5-lightning-30b-a3b` with its reasoning budget set to zero; `NVIDIA_NIM_MODEL` can override it on the server.

The Super Admin saves the key in Settings → AI providers. It is stored in `nim.json` inside the existing private provider-secrets volume, never returned to the browser, and must pass an explicit small synthetic test before use. A key change clears verification. ChatGPT stays first in `LLM_PROVIDER=chatgpt`; NIM is tried only when ChatGPT reports a plan usage block. `LLM_PROVIDER=nim` is available for an explicit server-side switch. Image generation remains with Gemini.

NIM calls reserve and settle against the existing AI Office text budget. Scheduled requests retain their half-budget guard; usage is attributed to NIM in task and API usage logs. The database migration only adds `nim` to provider checks and the existing reservation function. It preserves saved limits and prior usage. NVIDIA charges or trial credits are governed by the NVIDIA account; set the NIM price in Usage & billing if a cost estimate is wanted.

Production migration `20261027000300_nvidia_nim.sql` was applied and read back in Supabase. The corrected app image `parakkat-ai-office:nim-20261027-r2` was deployed to the dedicated app and scheduler. The previous image is retained as `parakkat-ai-office:before-nim-20261027-r2`. The app is healthy, office controls are unchanged, and 22 unrelated VPS containers including Hermes were untouched.

The first live key test found that the original Llama 3.3 default had been removed from the key's model catalog. A metered synthetic request confirmed the Nemotron Lightning model and that `reasoning_budget: 0` produces concise JSON. After the r2 release, the saved key passed the live synthetic test. The AI providers page showed **Fallback ready** and confirmed that ChatGPT usage-limit fallback is enabled. This verifies the NIM endpoint and key; it does not require exhausting the ChatGPT plan to simulate a real agent task.

The later quality-gated routing change is described in `MODEL_ROUTING_2026-10-27.md`. It uses NIM for selected internal drafts when ChatGPT review is available, and pauses quality-critical workflows during a ChatGPT plan block.

Local validation: `npm run build`, `npm run typecheck`, and `node --test tests/nim.test.mjs tests/ai-budget.test.mjs` passed. Live success screenshot: `/tmp/parakkat-nim-verified-live.jpg`. Deployment proof: `/tmp/parakkat-nim-r2-cutover.json`, `/tmp/parakkat-nim-r2-post-test-runtime.json`, and `/tmp/parakkat-nim-r2-post-test-db.json`.
