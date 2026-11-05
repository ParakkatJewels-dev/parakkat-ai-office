# Editing computer worker (Mac or Windows)

## AI Office jobs with Claude Max on Windows

This is the subscription workflow: assign a job on AI Office's **Video editing**
page, then a Claude Code session running on the Windows editing PC receives it
through a local [Claude Code Channel](https://code.claude.com/docs/en/channels).
Claude Code signs in through Anthropic's own Max login. AI Office never sees or
stores the Claude credential. The channel polls AI Office for a queued job,
notifies Claude, and Claude claims it, edits with the local `/video-edit` skill,
exports through Resolve Studio, and reports the local MP4 and `.drp` paths to
AI Office. Raw video stays on the PC; Claude sees preview frames and task text.

Channels are in research preview. This custom channel needs a first-run
development-channel confirmation in Claude Code. The signed-in Claude session,
Windows desktop, and Resolve must remain open and awake. Tool permissions may
need approval in the session; type `/remote-control` there if you want to watch
or approve work from `https://claude.ai/code` on another device.

Before starting this PC workflow, apply the video job SQL migration to the
AI Office Supabase project, deploy the current AI Office source to its VPS, and
set `VIDEO_WORKER_TOKEN` (at least 32 random characters) in the VPS
`/opt/parakkat-ai-office/runtime.env`. Put the **same** secret in this PC's
private `subscription.env` beside the launcher. Copy
`subscription.env.example` as a starting point. The example uses
`E:\Ai-Office\Videos` for raw footage and `E:\Ai-Office\Exports` for exports;
adjust them to the actual folders. Do not put a Claude API key in this file.
Optionally set `VIDEO_MEDIA_ROOT_HINT` in the AI Office VPS runtime environment
to the same media root (for example `E:\Ai-Office\Videos`). The Video editing
form can then accept a pasted full path under that root, as well as a relative
folder name. The worker still checks the path against its own configured root.

The PC needs Node.js LTS in addition to Python, FFmpeg, Claude Code, and the
Resolve connection. Double-click `run-ai-office-subscription.cmd`. Opening
Claude Code normally does not connect the AI Office video queue. The launcher installs
the small local MCP dependency on first run, checks Resolve and the office
queue, and starts the signed-in Claude Code session with the channel enabled.
Confirm the channel warning and the new MCP server when Claude asks. Leave the
terminal open. Create a short test job in AI Office with a source folder name
relative to the media root, such as `Test`. A failed or lost job requires
checking the Resolve project and export folder before retrying.

The editing PC does not need an AI Office browser login. Its private
`subscription.env` token authenticates the channel and the worker updater.
For automatic startup, double-click `install-ai-office-autostart.cmd` **once**
from the worker folder that contains your private `subscription.env`. It creates
a shortcut in your Windows Startup folder and opens the AI Office Claude session
now. The shortcut starts it again whenever you sign in to Windows. The visible
PowerShell window retries every 30 seconds if Resolve or Claude is not ready;
closing that window stops the editor until the next sign-in. The script tries to
open Resolve from its standard installation path. Windows must remain signed in
and awake, and you may need to respond to Claude sign-in or permission prompts.

The subscription editing bridge makes ordered cuts, portrait or landscape
exports, a global CDL grade, and basic music and timed sound-effect tracks. It
checks export dimensions and audible audio. Keep each export's `-assets` folder
beside its MP4 and `.drp`; the Resolve project references those prepared audio
stems. Captions, complex transitions, and a full creative review still require
additional editing work and must be checked on the exported video.

### Updating this Windows worker

To update an existing Windows worker without signing in to AI Office there,
close the old Claude Code window and run these commands in Command Prompt:

```cmd
cd /d "C:\path\to\your\video-worker"
py -3 update_worker.py
install-ai-office-autostart.cmd
```

The updater uses the existing token in `subscription.env`, verifies the package
checksum, and keeps the private settings. The final command is a one-time setup
for startup at Windows sign-in; it also opens the editor now. If the older
worker folder does not contain `update_worker.py`, download the ZIP while signed
in to AI Office on another device and transfer it to this PC. The ZIP never
contains the private settings. The launcher detects a previously rejected MCP
server and tells you how to reset Claude's saved choice.

After this one-time update, the running channel checks AI Office every five
minutes for a newer worker package over HTTPS. It verifies the package checksum
and installs code and guide changes only while no video job is active. A newly
claimed job reads the current `EDITING_GUIDE.md`, and each Python editing command
loads the current bridge code. Routine editing improvements therefore apply to
the next job without downloading another ZIP or restarting Claude. Changes to
the channel's tool definitions still require restarting the Claude session.
The Startup shortcut also restarts the channel at the next Windows sign-in.
The worker does not need GitHub access or a second repository.

The worker can save detailed style-study findings to the AI Office job through
`video_job_report`, and keeps `video-editor-style-profile.md` under the export
folder for future local edits. This profile describes example edits and usable
assets; it does not retrain Claude's model weights.

## Claude Max Remote Control (interactive, no API key)

This folder also contains a local Claude Code skill, `/video-edit`, and
`remote_edit.py`. It lets the person signed in with Claude Max start Claude Code
**on the editing computer**, then direct it from another device using
[Remote Control](https://code.claude.com/docs/en/remote-control). Remote Control
keeps the local filesystem and tools available, and the editing computer must
stay awake with Resolve and the Claude session running.

On Windows, open Command Prompt in this folder and run:

```cmd
run-claude-max-windows.cmd
```

The launcher checks the local editing tools and starts Remote Control in this
folder, so Claude Code discovers the `/video-edit` skill. It ignores any API key
setting for this one session and uses the subscriber's Claude login. On macOS,
run `chmod +x run-claude-max-macos.sh && ./run-claude-max-macos.sh`.

If prompted, sign in to Claude Code using the owner's Max account. On another
device, sign in to `https://claude.ai/code` with the same account and open that
Remote Control session. Send a task such as:

> /video-edit Make a 15-second highlight from E:\Ai-Office\Videos\Test.
> Save the MP4 and Resolve project in E:\Ai-Office\Exports.

Claude can inspect the source folder, choose ordered cuts, invoke the local
Resolve bridge and report the output paths. This direct Remote Control path
does **not** read `config.env` or require an API key or worker token. The AI
Office channel above uses a worker token to read and update its job queue.

The included bridge supports ordered cuts, basic grading and audio tracks, but
does not produce captions, complex transitions, or a reviewed creative final.

## Legacy unattended CLI worker (API key)

This worker receives **only the task brief and a folder name** from AI Office. It reads
footage from `VIDEO_MEDIA_ROOT`, asks Claude Code on this computer to plan ordered cuts,
uses Resolve Studio's local Python scripting API, exports an MP4 and `.drp` project
backup under `VIDEO_EXPORT_ROOT`, and reports the local paths to AI Office. It runs
on the computer with Resolve Studio; that computer may be a Mac or Windows PC.

The starter Resolve bridge handles ordered cuts from existing video and source audio.
It does not promise subtitles, colour grading, effects, music licensing or a final
creative review. Replace `resolve_bridge.py` through `VIDEO_BRIDGE_SCRIPT` when the
existing Claude–Resolve setup offers those operations.

## Office setup

1. Apply `supabase/migrations/20261104000000_video_edit_jobs.sql` to the AI Office
   Supabase project using the normal migration process.
2. Generate a random secret, for example `openssl rand -hex 32`, and set
   `VIDEO_WORKER_TOKEN` in the current AI Office VPS runtime environment at
   `/opt/parakkat-ai-office/runtime.env`. Deploy this source revision to that VPS
   using [the self-hosted release process](../../docs/SELF_HOST.md). The former
   Vercel project was retired; do not configure it for this worker.
3. Open **Video editing** in AI Office. The existing Video Editor employee uses this
   queue. Source folders entered there are relative to the editing computer's media root.

## Requirements on either editing computer

1. Install Claude Code **on the editing computer**. For unattended jobs dispatched by a
   shared AI Office, configure `ANTHROPIC_API_KEY` in this computer's private `config.env`
   using an API key owned by the worker's operator. This is separate from a Claude
   Max subscription and follows Anthropic's [authentication guidance](https://code.claude.com/docs/en/legal-and-compliance).
   Check `claude --version`; the worker uses `--restricted`, `--tools Read`, and
   `--json-schema`. AI Office never receives the editing computer's Claude credential.
2. Install `ffmpeg`, `ffprobe` and Python 3.10+. On Mac, Homebrew can provide
   these tools and `run-macos.sh` prefers Homebrew Python.
3. In DaVinci Resolve Studio, set **Preferences → System → General → External
   Scripting Using** to **Local**. Restart Resolve and leave it running in a logged-in
   desktop session. The worker cannot render while the computer is asleep or Resolve is
   closed.
4. Copy this `deploy/video-worker` directory to the editing computer. Source footage
   stays there; the worker only sends the brief, metadata and preview frames to Claude.

## Mac setup

1. Copy
   `config.env.example` to `config.env`; set the public AI Office HTTPS URL, the
   same worker token, the Anthropic API key and absolute media/export roots. Run
   `chmod 600 config.env` and `chmod +x run-macos.sh`.
2. Test Resolve first with `./run-macos.sh --check-resolve`. Then test all
   settings in that logged-in session: `./run-macos.sh --check`, then
   `./run-macos.sh`. Put a short
   sample clip in a child folder of the media root and assign a short test edit in
   AI Office. Confirm the `.drp` and `.mp4` appear under the export root.

The worker makes outbound HTTPS requests; no remote desktop port or incoming
connection to the editing computer is required. Keep the token private. If the worker disconnects
mid-job, AI Office marks the job failed after its lease expires. Check Resolve and
the export folder before pressing **Retry after checking output**.

For an always-on Mac, run `chmod +x install-macos.sh && ./install-macos.sh` after
testing in Terminal. This installs a user LaunchAgent and writes logs to
`~/Library/Logs/parakkat-video-worker*.log`. A LaunchAgent belongs to the same
logged-in user session as Resolve. Do not run it as a headless system daemon.

## Windows setup

1. Install Python 3.10+, ffmpeg/ffprobe and Claude Code, and verify that `py -3`,
   `ffmpeg`, `ffprobe` and `claude` work in a new PowerShell window. Set Resolve
   Studio's **External Scripting Using** preference to **Local**, restart Resolve,
   and keep it open in the same signed-in desktop session.
2. Copy `config.windows.env.example` to `config.env`. Set the same office URL and
   worker token, your own `ANTHROPIC_API_KEY`, and the input/export folders. The
   example uses `%USERPROFILE%`, which the PowerShell launcher expands.
3. In Command Prompt or PowerShell, run `.\run-windows.cmd --check-resolve` from
   this worker folder before creating any secrets. Then run
   `.\run-windows.cmd --check`, followed by
   `.\run-windows.cmd`. Put a short clip in a child folder of the input root and
   assign a matching test edit in AI Office. Check for `.drp` and `.mp4` files in
   the export root.
4. After the test succeeds, stop the test worker with Ctrl+C. Run
   `./install-windows.ps1` from PowerShell. It creates a shortcut in your user
   Startup folder so the worker starts when that user signs in. Windows must stay
   signed in and awake, and Resolve must remain open.

## Existing Python bridge

If you already have a Claude–Resolve Python script, make a small adapter that accepts
one command-line argument: the path to `manifest.json`. It should save the Resolve
project, export the video locally, then print one JSON object on stdout:

```json
{"project_path":"/absolute/path/edit.drp","export_path":"/absolute/path/edit.mp4"}
```

The manifest contains `source_root`, `output_root`, `output_name`, `brief`, `media`,
and Claude's validated `plan.segments` (`file`, `start_seconds`, `end_seconds`).
Point `VIDEO_BRIDGE_SCRIPT` at the adapter. The default `resolve_bridge.py` can be
used until the existing bridge is located.
