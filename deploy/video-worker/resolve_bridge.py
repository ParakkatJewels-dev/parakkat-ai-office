#!/usr/bin/env python3
"""Starter Resolve Studio bridge: imported clips, ordered cuts, saved project, MP4 render.

Replace this file with an adapter to an existing Claude–Resolve bridge if that bridge
supports more editing operations. It must accept a manifest path and print JSON with
project_path and export_path. Run in the same logged-in desktop session as Resolve.
"""
import json
import math
import os
import sys
import time
from fractions import Fraction
from pathlib import Path

def scripting_module():
    locations = []
    if os.environ.get('RESOLVE_SCRIPT_API'):
        locations.append(Path(os.environ['RESOLVE_SCRIPT_API']) / 'Modules')
    if sys.platform == 'darwin':
        locations.append(Path('/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules'))
    elif sys.platform == 'win32':
        locations.append(Path(os.environ.get('PROGRAMDATA', r'C:\ProgramData')) / 'Blackmagic Design/DaVinci Resolve/Support/Developer/Scripting/Modules')
    for location in locations:
        if location.is_dir():
            sys.path.insert(0, str(location))
    import DaVinciResolveScript as dvr  # type: ignore
    resolve = dvr.scriptapp('Resolve')
    if resolve is None:
        raise RuntimeError('DaVinci Resolve is not running or External Scripting is not set to Local')
    return resolve

def require(value, message):
    if value is None or value is False:
        raise RuntimeError(message)
    return value

def main(manifest_path):
    data = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
    root = Path(data['source_root']).resolve(strict=True)
    output = Path(data['output_root']).resolve(strict=True)
    job_id = data['job_id']
    name = data['output_name']
    project_name = f"Parakkat edit {job_id}"
    files = {}
    for item in data['media']:
        path = (root / item['file']).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise RuntimeError('Invalid media path in manifest')
        files[item['file']] = path
    resolve = scripting_module()
    manager = require(resolve.GetProjectManager(), 'Resolve project manager is unavailable')
    project = manager.CreateProject(project_name)
    if project is None:
        # A previous uncertain run may have created the project. Do not overwrite it.
        raise RuntimeError(f'Resolve project {project_name} already exists; inspect it before retrying')
    pool = require(project.GetMediaPool(), 'Resolve Media Pool is unavailable')
    storage = require(resolve.GetMediaStorage(), 'Resolve media storage is unavailable')
    imported = require(storage.AddItemListToMediaPool([str(path) for path in files.values()]), 'Resolve could not import the source videos')
    imported_by_path = {}
    for clip in imported:
        imported_by_path[os.path.normcase(str(Path(clip.GetClipProperty('File Path')).resolve()))] = clip
    timeline = require(pool.CreateEmptyTimeline(name), 'Resolve could not create a timeline')
    require(project.SetCurrentTimeline(timeline), 'Resolve could not select the timeline')
    segments = []
    for item in data['plan']['segments']:
        path = files[item['file']]
        clip = imported_by_path.get(os.path.normcase(str(path)))
        if clip is None:
            raise RuntimeError(f'Resolve did not import {item["file"]}')
        fps_text = str(clip.GetClipProperty('FPS') or '0')
        try: fps = float(Fraction(fps_text))
        except (ValueError, ZeroDivisionError): fps = 0
        if fps <= 0: raise RuntimeError(f'Could not read frame rate for {item["file"]}')
        start = math.floor(float(item['start_seconds']) * fps)
        end = math.ceil(float(item['end_seconds']) * fps) - 1
        if end <= start: raise RuntimeError('Edit segment is shorter than two frames')
        segments.append({'mediaPoolItem': clip, 'startFrame': start, 'endFrame': end})
    require(pool.AppendToTimeline(segments), 'Resolve could not assemble the timeline')
    require(manager.SaveProject(), 'Resolve could not save the project')
    project_path = output / f'{name}-{job_id}.drp'
    require(manager.ExportProject(project_name, str(project_path)), 'Resolve could not export the project backup')
    require(project.SetCurrentRenderFormatAndCodec('mp4', 'H264'), 'Resolve could not select MP4 H.264 encoding')
    render_name = f'{name}-{job_id}'
    require(project.SetRenderSettings({'TargetDir': str(output), 'CustomName': render_name, 'SelectAllFrames': True}), 'Resolve could not configure export')
    render_id = require(project.AddRenderJob(), 'Resolve could not add a render job')
    require(project.StartRendering(render_id), 'Resolve could not start rendering')
    deadline = time.monotonic() + 7000
    started_at = time.monotonic()
    while True:
        status = project.GetRenderJobStatus(render_id) if hasattr(project, 'GetRenderJobStatus') else None
        state = str((status or {}).get('JobStatus', '')).lower()
        if state in ('complete', 'completed'):
            break
        if state in ('failed', 'cancelled', 'canceled'):
            raise RuntimeError(f'Resolve render {state}')
        if not project.IsRenderingInProgress() and time.monotonic() - started_at > 10:
            break
        if time.monotonic() > deadline:
            raise TimeoutError('Resolve render exceeded its time limit')
        time.sleep(3)
    export_path = output / f'{render_name}.mp4'
    if not export_path.is_file() or export_path.stat().st_size < 1024:
        raise RuntimeError('Resolve finished without creating a usable MP4; check its render job status')
    require(manager.SaveProject(), 'Resolve could not save the completed project')
    print(json.dumps({'project_path': str(project_path), 'export_path': str(export_path)}))

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: resolve_bridge.py MANIFEST.json')
    main(sys.argv[1])
