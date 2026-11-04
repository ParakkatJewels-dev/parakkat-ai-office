---
name: video-edit
description: Edit source videos stored on this computer in DaVinci Resolve Studio and export a local MP4 plus a Resolve project backup.
---

# Video edit on this computer

Use this skill only in a Claude Code session running **locally on the editing computer**. The user provides a source folder and an edit brief. Keep all exports on this computer. Do not use the AI Office queue or ask for an API key.

1. Run `py -3 remote_edit.py check` on Windows or `python3 remote_edit.py check` on macOS from the worker folder. DaVinci Resolve Studio must be open in the same logged-in desktop session.
2. Identify the exact source folder and export folder. If the user did not give an export folder, use a sibling `Exports` folder outside the source folder. Choose a short output name using letters, numbers, dots, dashes, and underscores.
3. Run `remote_edit.py inspect SOURCE_FOLDER --output-root EXPORT_FOLDER --output-name NAME --brief BRIEF` with the appropriate Python launcher. Read the returned `manifest.json` and preview JPEGs. Inspect enough frames to understand each candidate clip. The preview frames are only samples; do not claim to have watched unseen footage. Use local tools to inspect audio or additional frames when the brief requires it.
4. Write `plan.json` in the same `_remote_jobs` folder. Its shape is `{"summary":"what the edit contains","segments":[{"file":"exact relative source filename","start_seconds":0.0,"end_seconds":3.5}]}`. Order segments as they should appear. Use only source filenames and durations from the manifest. Follow the brief where the footage supports it; explain any unmet part.
5. Run `remote_edit.py render MANIFEST_PATH --plan PLAN_PATH`. This calls the local Resolve Python bridge, saves a `.drp` project backup, and exports an MP4. Confirm the paths and duration from the command output. If rendering fails after Resolve creates a project, inspect the project before retrying; do not overwrite or delete it blindly.
6. Reply with the MP4 and `.drp` paths, what was edited, and any request the current bridge could not complete.

The included bridge makes ordered cuts with source audio. It does not add captions, grading, effects, licensed music, or advanced sound mixing. If the user requests those, use an installed adapter via `VIDEO_BRIDGE_SCRIPT` or explain the missing operation; never claim it was completed without checking the export.
