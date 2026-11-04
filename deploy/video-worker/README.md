# Editing computer worker (Mac or Windows)

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
