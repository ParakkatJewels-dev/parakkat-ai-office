# Isolated ChatGPT image pilot

This is a separate, one-off Codex CLI runner for verifying built-in image generation with a ChatGPT login on the VPS. It does not poll AI Office, change its configuration, import artwork, publish images, or start a scheduler. The default command prints help and exits.

The image pins `@openai/codex@0.165.0` on `node:22-bookworm-slim`. At build time it exports that official Node image's bundled Mozilla root certificates to `/etc/ssl/certs/ca-certificates.crt` and verifies the file is nonempty. Native Codex receives that fixed `SSL_CERT_FILE` path; TLS verification stays enabled and no additional package-repository bootstrap is needed. Its default CLI arguments require ChatGPT login, store credentials in its own file-backed `CODEX_HOME`, enable `features.image_generation`, and disable Apps. The feature flag is a request for this pinned client; a successful authenticated image pilot is still required to establish tool availability for this account and server. ChatGPT plan limits still apply.

## Isolation

- Compose project: `parakkat-chatgpt-images`; service: `worker`; profile: `pilot`.
- Runs as UID/GID 1000, with 0.5 CPU, 1 GiB RAM, no extra swap allowance and 128 PIDs.
- Read-only container root, writable private `CODEX_HOME` and `/work` volumes, bounded temporary storage, dropped Linux capabilities and `no-new-privileges`.
- No host ports, proxy labels, Docker socket, host paths, existing application volumes or shared application networks.
- No `env_file`, API keys, Supabase credentials, cron secret or AI Office worker secret. The default entrypoint clears inherited environment; `pilot.mjs` also filters the environment passed to Codex.
- No automatic restart or startup generation. The image contains queue-runner source for a later integration, but this Compose file does not configure or run that supervisor.

The pilot network permits outbound requests to reach ChatGPT. It is separate from other Compose networks, but it is not an outbound-access allowlist. Do not broaden this pilot with host mounts, host networking, privileged mode or the Docker socket to address a failed test.

## Build and inspect

Run from the repository root, or substitute the path to this isolated directory after copying it to the server. Use only this Compose file, not the existing AI Office deployment files.

```sh
docker compose -f deploy/chatgpt-image-worker/compose.yml config --quiet
docker compose -f deploy/chatgpt-image-worker/compose.yml build worker
docker compose -f deploy/chatgpt-image-worker/compose.yml run --rm worker --version
docker compose -f deploy/chatgpt-image-worker/compose.yml run --rm worker --help
```

Building does not contact an authenticated image provider or start generation. Check available disk space before building on the shared VPS. Do not prune or restart other services to make room.

## Dedicated ChatGPT login

Create a separate login for this runner. Do not mount or copy the existing AI Office OAuth credential volume, and do not share a rotating login cache with another running Codex process.

```sh
docker compose -f deploy/chatgpt-image-worker/compose.yml run --rm worker login --device-auth
docker compose -f deploy/chatgpt-image-worker/compose.yml run --rm worker login status
```

Complete the displayed sign-in in your own browser. Device code login may need enabling in ChatGPT account security settings or workspace permissions. Keep the login output private; never print or commit the stored credentials. The project-owned `codex-home` volume persists across one-off container removal and image updates.

## Explicit image pilot

Only run this step when one image using the account's plan allowance is intended. The included supervisor makes one requested attempt, saves its local result under `/work/pilot-<UUID>`, and does not import it into AI Office. A failure has no automatic generation retry or paid-provider fallback.

```sh
docker compose -f deploy/chatgpt-image-worker/compose.yml run --rm --entrypoint node worker /opt/chatgpt-image-worker/pilot.mjs
```

Use `pilot.mjs` for this check. It reads the trusted Codex CLI session receipt and collects exactly one validated PNG from that session's native output directory. The supervisor saves `output.png` and its proof; the model does not need a shell or file-copy command. A later command failure or timeout can still leave a valid native image, so inspect the saved receipt and output before considering any new generation.

Inspect the pilot result before implementing scheduled queue processing. If the CLI cannot run its sandbox under these container restrictions, record that failure and review the container-specific solution; do not relax the shared host or other applications. A successful login or feature listing alone is not an image-generation result.

## Stop and preserve the login

The one-off commands remove their containers when finished. To remove only this project's idle containers and network while retaining its private volumes:

```sh
docker compose -f deploy/chatgpt-image-worker/compose.yml down
```

Do not add `-v` unless deliberately deleting this pilot's saved login and output. Do not issue broad Docker prune, shared-proxy restarts or commands against other Compose projects.

Official references: [Codex authentication](https://learn.chatgpt.com/docs/auth), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

The separate [queue deployment notes](QUEUE.md) describe the supervisor configuration and activation commands. Its override is not included or activated by any pilot command above. Current deployment results are recorded in the [VPS verification report](../../docs/CHATGPT_VPS_WORKER_CHECK_2026-10-29.md).
