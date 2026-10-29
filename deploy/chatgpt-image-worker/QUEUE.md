# Queue integration staging

`compose.queue.yml` is a separate, inactive override for the future AI Office queue supervisor. Do not include it in the pilot build/login commands. Activate it only after the pinned Linux image has generated and saved a verified built-in-tool result with the dedicated ChatGPT login, and the authenticated queue claim/import integration has passed its tests.

The supervisor runs as UID/GID 0 inside this isolated container so its control files and narrowly scoped worker credential are inaccessible to the generated-image process. It launches Codex as UID/GID 1000 with a filtered environment. This does not grant host-root access: the container keeps its read-only root, project-only volumes/network, resource limits, dropped capabilities and lack of Docker socket or host mounts.

The override adds only `CHOWN`, `SETUID`, `SETGID`, `DAC_READ_SEARCH` and `KILL`. These allow preparing workspace ownership, dropping the child's identity, reading its output and terminating an overdue child. The runner must retain write access through file ownership/group permissions, because `DAC_READ_SEARCH` does not bypass write permissions. Verify that behavior in the exact image before starting the queue. Do not substitute privileged mode or broad capabilities to conceal a failed permission check.

## Private configuration

The endpoint is the complete HTTPS URL of AI Office's authenticated image-worker route. The credential must be a new worker-only token, not an API key, Supabase key or the existing scheduler secret. Save it in a separate host file owned by root with mode `0600` or `0400`. Only that file is mounted, read-only, at `/run/secrets/image-worker`.

Docker Compose's file-backed secrets may preserve the source file's ownership and permissions rather than applying `uid`, `gid` or `mode`; the host file must already satisfy the private ownership requirement. The supervisor checks it on startup. Pass only the file path through `CHATGPT_IMAGE_WORKER_SECRET_PATH`; never put the token value in a command argument, process environment or Compose file.

Keep `/work/control` root-owned mode `0700`. The Codex workspace and private `CODEX_HOME` must remain usable by UID1000. The child process receives no worker token, application secret or paid-provider key. Use only one running process with this dedicated Codex login; finish/remove one-off pilot containers before starting the queue.

## Review the effective deployment

Set these non-secret values for the intended deployment; substitute the actual endpoint and private credential-file path:

```sh
export CHATGPT_IMAGE_WORKER_URL='https://ai-office.parakkatjewels.in/api/internal/chatgpt-artwork'
export CHATGPT_IMAGE_WORKER_SECRET_PATH='/opt/parakkat-chatgpt-images/image-worker.secret'
docker compose -f deploy/chatgpt-image-worker/compose.yml \
  -f deploy/chatgpt-image-worker/compose.queue.yml config --quiet
```

The example route must match the implemented backend. Neither setting creates a credential, verifies account access or activates the queue. Review that the resolved Compose project is `parakkat-chatgpt-images`, that its image includes the validated runner, and that it has no existing application mounts or shared networks.

## Explicit activation after validation

This command starts processing authorized pending image jobs. Do not run it merely to check login or image-tool availability.

```sh
docker compose -f deploy/chatgpt-image-worker/compose.yml \
  -f deploy/chatgpt-image-worker/compose.queue.yml --profile queue \
  up -d --no-build --no-deps worker
```

The queue checks every 15 minutes and handles one image at a time. It preserves generated output and dispatch records so a restart can finish import without repeating an uncertain generation. The 26-minute stop grace allows the runner's bounded active attempt to settle. Existing AI Office and its scheduler are separate services and are not recreated by these commands.

To stop only this queue service while retaining its auth, output and recovery records:

```sh
docker compose -f deploy/chatgpt-image-worker/compose.yml \
  -f deploy/chatgpt-image-worker/compose.queue.yml stop worker
```

No automatic paid fallback is configured. Plan exhaustion, authentication problems and unavailable image tools must remain blocked or uncertain as appropriate; they must not silently call Higgsfield credits or a separately billed image API.
