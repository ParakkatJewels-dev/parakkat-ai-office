#!/usr/bin/env python3
"""Starter Resolve Studio bridge: imported clips, ordered cuts, saved project, MP4 render.

Replace this file with an adapter to an existing Claude–Resolve bridge if that bridge
supports more editing operations. It must accept a manifest path and print JSON with
project_path and export_path. Run in the same logged-in desktop session as Resolve.
"""
import json
import math
import os
import subprocess
import sys
import time
import wave
from collections import defaultdict
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


def clip_fps(clip, label):
    """AppendToTimeline source ranges use the media item's FPS, not timeline FPS."""
    fps_text = str(clip.GetClipProperty('FPS') or '0')
    try:
        fps = float(Fraction(fps_text))
    except (ValueError, ZeroDivisionError):
        fps = 0
    if not math.isfinite(fps) or fps <= 0:
        raise RuntimeError(f'Could not read source frame rate for {label}: {fps_text}')
    return fps


def audio_source_end_frame(duration_seconds, source_fps):
    """The audio clip range is measured in its media-pool source frames."""
    return max(0, math.ceil(duration_seconds * source_fps) - 1)


def matching_project_preset(project, target):
    """Use only a deliberately named AI Office preset; other presets may change colour."""
    orientation = 'vertical' if target['height'] > target['width'] else 'horizontal' if target['width'] > target['height'] else 'square'
    rate = f"{target['fps']:g}"
    wanted = f'AI Office {rate}p {orientation}'
    presets = project.GetPresetList() or []
    names = {item.get('Name') if isinstance(item, dict) else item for item in presets}
    if wanted not in names:
        return None
    protected = ('colorScienceMode', 'colorSpaceTimeline', 'colorSpaceOutputGamma', 'hdrDolbyMasterDisplay')
    before = {key: project.GetSetting(key) for key in protected}
    require(project.SetPreset(wanted), f'Resolve could not apply project preset {wanted}')
    changed = [key for key in protected if project.GetSetting(key) != before[key]]
    if changed:
        raise RuntimeError(f'Project preset {wanted} changes colour/HDR settings ({", ".join(changed)}); create a clean preset before editing')
    return wanted

def edit_format(data):
    """Choose a deliverable format from the brief and selected clip geometry."""
    media = {item['file']: item for item in data['media']}
    orientation_seconds = defaultdict(float)
    chosen_fps = None
    for segment in data['plan']['segments']:
        item = media[segment['file']]
        width, height = item.get('width'), item.get('height')
        if width and height:
            orientation = 'portrait' if height > width * 1.1 else 'landscape' if width > height * 1.1 else 'square'
            orientation_seconds[orientation] += segment['end_seconds'] - segment['start_seconds']
        if chosen_fps is None:
            try: chosen_fps = float(Fraction(str(item.get('fps') or '')))
            except (ValueError, ZeroDivisionError): pass
    brief = str(data.get('brief', '')).lower()
    if any(word in brief for word in ('horizontal', 'landscape', '16:9', 'widescreen')):
        orientation = 'landscape'
    elif any(word in brief for word in ('vertical', 'portrait', '9:16', 'reel', 'shorts', 'tiktok')):
        orientation = 'portrait'
    else:
        orientation = max(orientation_seconds, key=orientation_seconds.get) if orientation_seconds else 'landscape'
    width, height = {'portrait': (1080, 1920), 'landscape': (1920, 1080), 'square': (1080, 1080)}[orientation]
    supported = (23.976, 24, 25, 29.97, 30, 50, 59.94, 60)
    requested_fps = data['plan'].get('fps')
    fps = requested_fps if requested_fps is not None else min(supported, key=lambda value: abs(value - (chosen_fps or 30)))
    return {'width': width, 'height': height, 'fps': fps}

def prepare_audio(source, destination, duration, gain_db, music=False):
    destination.parent.mkdir(parents=True, exist_ok=True)
    filters = []
    if music:
        filters.append('loudnorm=I=-14:TP=-1.5:LRA=11')
    filters.append(f'volume={float(gain_db):g}dB')
    if music:
        filters.extend(('afade=t=in:st=0:d=0.15', f'afade=t=out:st={max(0, duration - 0.5):.3f}:d=0.5'))
    command = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y']
    if music:
        command.extend(['-stream_loop', '-1'])
    command.extend(['-i', str(source), '-t', f'{duration:.3f}', '-vn', '-ac', '2', '-ar', '48000',
                    '-af', ','.join(filters), '-c:a', 'pcm_s16le', str(destination)])
    done = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if done.returncode or not destination.is_file() or destination.stat().st_size < 1024:
        raise RuntimeError(f'Could not prepare audio: {(done.stderr or done.stdout)[-500:]}')

def add_audio(data, timeline, pool, storage, assets_dir, target):
    audio = data['plan'].get('audio') or {}
    if not audio:
        return None
    duration = sum(item['end_seconds'] - item['start_seconds'] for item in data['plan']['segments'])
    start_frame = require(timeline.GetStartFrame(), 'Resolve could not read timeline start')
    fps = target['fps']
    choices = []
    if 'music' in audio:
        choices.append(('music', audio['music']))
    choices.extend((f'sfx-{index + 1}', item) for index, item in enumerate(audio.get('sound_effects', [])))
    placements = []
    for label, item in choices:
        at = float(item.get('at_seconds', 0))
        prepared = assets_dir / f'{label}.wav'
        prepare_audio(Path(item['file']).resolve(strict=True), prepared, duration - at, item.get('gain_db', 0), music=(label == 'music'))
        with wave.open(str(prepared), 'rb') as wav:
            prepared_duration = wav.getnframes() / wav.getframerate()
        imported = require(storage.AddItemListToMediaPool([str(prepared)]), f'Resolve could not import {label}')
        clip = imported[0]
        source_fps = clip_fps(clip, label)
        require(timeline.AddTrack('audio', 'stereo'), f'Resolve could not add an audio track for {label}')
        track_index = timeline.GetTrackCount('audio')
        wanted_duration = min(duration - at, prepared_duration)
        entry = {'mediaPoolItem': clip, 'startFrame': 0, 'endFrame': audio_source_end_frame(wanted_duration, source_fps),
                 'mediaType': 2, 'trackIndex': track_index, 'recordFrame': int(start_frame + round(at * fps))}
        appended = require(pool.AppendToTimeline([entry]), f'Resolve could not place {label} on the timeline')
        if not isinstance(appended, (list, tuple)) or len(appended) != 1:
            raise RuntimeError(f'Resolve did not return the placed {label} audio clip for duration verification')
        placed_frames = appended[0].GetDuration()
        expected_frames = round(wanted_duration * fps)
        if not isinstance(placed_frames, (int, float)) or abs(placed_frames - expected_frames) > 2:
            raise RuntimeError(f'Resolve placed {label} at {placed_frames} timeline frames, expected {expected_frames}; inspect audio FPS before rendering')
        placements.append({'label': label, 'source_fps': source_fps, 'timeline_fps': fps,
                           'source_end_frame': entry['endFrame'], 'expected_timeline_frames': expected_frames,
                           'placed_timeline_frames': placed_frames, 'start_seconds': at})
    (assets_dir / 'sources.json').write_text(json.dumps(audio, indent=2, ensure_ascii=False), encoding='utf-8')
    (assets_dir / 'timing.json').write_text(json.dumps(placements, indent=2), encoding='utf-8')
    return assets_dir

def main(manifest_path):
    data = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
    root = Path(data['source_root']).resolve(strict=True)
    output = Path(data['output_root']).resolve(strict=True)
    job_id = data['job_id']
    name = data['output_name']
    project_name = f"Parakkat edit {job_id}"
    target = edit_format(data)
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
    preset_applied = matching_project_preset(project, target)
    for key, value in (
        ('timelineResolutionWidth', str(target['width'])),
        ('timelineResolutionHeight', str(target['height'])),
        ('timelineFrameRate', str(target['fps'])),
    ):
        require(project.SetSetting(key, value), f'Resolve could not set {key} to {value}')
    playback_text = str(project.GetSetting('timelinePlaybackFrameRate') or '')
    try:
        playback_fps = float(Fraction(playback_text))
    except (ValueError, ZeroDivisionError):
        playback_fps = None
    preview_warning = None
    if playback_fps is None or abs(playback_fps - target['fps']) > 0.15:
        preview_warning = (f'Resolve project playback is {playback_text or "unknown"} fps while the timeline is '
                           f'{target["fps"]} fps. Resolve 21 does not expose a working scripting setter for playback '
                           'rate on this PC. Set Project Settings > Master Settings > Playback frame rate in the UI. '
                           'The exported MP4 uses the timeline/render rate; check it at 1x in a player.')
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
        fps = clip_fps(clip, item['file'])
        start = math.floor(float(item['start_seconds']) * fps)
        end = math.ceil(float(item['end_seconds']) * fps) - 1
        if end <= start: raise RuntimeError('Edit segment is shorter than two frames')
        segments.append({'mediaPoolItem': clip, 'startFrame': start, 'endFrame': end})
    timeline_items = require(pool.AppendToTimeline(segments), 'Resolve could not assemble the timeline')
    grade = data['plan'].get('grade')
    if grade:
        video_items = timeline.GetItemListInTrack('video', 1) if hasattr(timeline, 'GetItemListInTrack') else None
        if isinstance(video_items, (list, tuple)):
            timeline_items = video_items
        elif not isinstance(timeline_items, (list, tuple)):
            raise RuntimeError('Resolve could not list video timeline clips for grading')
        cdl = {
            'NodeIndex': '1',
            'Slope': ' '.join(str(v) for v in grade['slope']),
            'Offset': ' '.join(str(v) for v in grade['offset']),
            'Power': ' '.join(str(v) for v in grade['power']),
            'Saturation': str(grade['saturation']),
        }
        if len(timeline_items) != len(segments):
            raise RuntimeError('Resolve returned an unexpected number of timeline clips for grading')
        for index, item in enumerate(timeline_items):
            require(item.SetCDL(cdl), f'Resolve could not apply the colour grade to clip {index + 1}')
    audio_assets_dir = add_audio(data, timeline, pool, storage, output / f'{name}-{job_id}-assets', target)
    require(manager.SaveProject(), 'Resolve could not save the project')
    project_path = output / f'{name}-{job_id}.drp'
    require(manager.ExportProject(project_name, str(project_path)), 'Resolve could not export the project backup')
    require(project.SetCurrentRenderFormatAndCodec('mp4', 'H264'), 'Resolve could not select MP4 H.264 encoding')
    render_name = f'{name}-{job_id}'
    require(project.SetRenderSettings({'TargetDir': str(output), 'CustomName': render_name, 'SelectAllFrames': True,
                                       'FormatWidth': target['width'], 'FormatHeight': target['height'], 'FrameRate': target['fps'],
                                       'ExportAudio': True, 'AudioCodec': 'aac', 'AudioSampleRate': 48000}), 'Resolve could not configure export')
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
    print(json.dumps({'project_path': str(project_path), 'export_path': str(export_path), 'target_format': target,
                      'grade_applied': bool(grade), 'audio_applied': bool(audio_assets_dir),
                      'audio_assets_dir': str(audio_assets_dir) if audio_assets_dir else None,
                      'playback_fps': playback_fps, 'preview_warning': preview_warning,
                      'project_preset': preset_applied}))

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: resolve_bridge.py MANIFEST.json')
    main(sys.argv[1])
