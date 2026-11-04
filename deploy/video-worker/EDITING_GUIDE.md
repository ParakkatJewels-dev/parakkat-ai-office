# Current AI Office editing guide

Read this guide when claiming each job. Follow the job brief and the local `/video-edit` skill.

For style work, search the local Resolve project library and `E:\Ai-Office` for a few representative finished exports and project backups. Treat the originals as read-only. Save observations to `EXPORT_FOLDER/video-editor-style-profile.md` and call `video_job_report` with the evidence and limitations. This profile guides future edits; it does not train model weights.

For each new edit, inspect the source clips and profile, choose a cut plan, render through the local Resolve bridge, then verify the MP4 and `.drp` before completion. `remote_edit.py inspect` catalogs up to 500 source videos and returns up to 50 previewed clips at a time. If it returns `next_offset`, run `remote_edit.py inspect-batch MANIFEST_PATH --offset NEXT_OFFSET` until `next_offset` is null. Review clips across the pages before selecting; the plan can use any clip in the catalog and up to 300 segments. The bridge imports only clips selected in the plan. Report music, sound effects, and colour grading only when they are present in the rendered output. An audio file's presence does not establish a publication licence. Check evidence of permitted use before adding it to an export.

The current bridge supports ordered cuts with source audio. To add music, sound effects, or grading, first inspect the installed Resolve scripting README under `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting` and the exact local assets. Do not claim an unsupported operation was completed.
