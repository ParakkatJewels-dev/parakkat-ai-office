#!/usr/bin/env python3
"""Read-only inventory and evidence for local Resolve editing references.

No project is saved, changed, rendered, imported, or exported by this tool.
Project switching is opt-in because Resolve may have an unsaved active project.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import shutil
from datetime import datetime, timezone
from pathlib import Path

VIDEO = {'.mp4', '.mov', '.mxf', '.mkv', '.avi', '.webm'}
AUDIO = {'.wav', '.mp3', '.aif', '.aiff', '.flac', '.m4a'}
PROJECT = {'.drp', '.dra', '.drt', '.xml', '.fcpxml'}
EXCLUDE = {'node_modules', '.git', '.audio-skills-venv', '_remote_jobs'}


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    os.replace(temporary, path)


def scan(root, output, max_files=100000):
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Media root is not a directory')
    output.mkdir(parents=True, exist_ok=True)
    inventory = output / 'video-editor-inventory.jsonl'
    counts = {'video': 0, 'audio': 0, 'project': 0, 'other': 0, 'unreadable': 0}
    examples = {key: [] for key in ('video', 'audio', 'project')}
    visited = 0
    with inventory.open('w', encoding='utf-8') as stream:
        for directory, folders, files in os.walk(root, followlinks=False):
            folders[:] = sorted(name for name in folders if name not in EXCLUDE and not (Path(directory) / name).is_symlink())
            for name in sorted(files):
                path = Path(directory) / name
                if path.is_symlink():
                    continue
                visited += 1
                if visited > max_files:
                    raise RuntimeError(f'Inventory stopped after {max_files} files; increase --max-files to include the rest')
                kind = ('video' if path.suffix.lower() in VIDEO else 'audio' if path.suffix.lower() in AUDIO
                        else 'project' if path.suffix.lower() in PROJECT else 'other')
                counts[kind] += 1
                try:
                    stat = path.stat()
                except OSError:
                    counts['unreadable'] += 1
                    continue
                record = {'path': str(path), 'kind': kind, 'bytes': stat.st_size, 'modified': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()}
                stream.write(json.dumps(record, ensure_ascii=False) + '\n')
                if kind in examples and len(examples[kind]) < 100:
                    examples[kind].append(record)
    summary = {'scanned_at': now(), 'root': str(root), 'inventory_path': str(inventory), 'counts': counts,
               'total_files': visited, 'examples': examples, 'scope': 'filesystem metadata; no media decoded'}
    write_json(output / 'video-editor-inventory-summary.json', summary)
    return summary


def call(obj, method, *args):
    try:
        return getattr(obj, method)(*args)
    except Exception:
        return None


def project_names(manager):
    original_folder = call(manager, 'GetCurrentFolder')
    if not call(manager, 'GotoRootFolder'):
        return {'error': 'Could not open Resolve project library root'}, []
    found = []
    def walk(parts, depth):
        if depth > 12:
            return
        for name in call(manager, 'GetProjectListInCurrentFolder') or []:
            found.append({'folder': '/'.join(parts), 'name': str(name)})
        for folder in call(manager, 'GetFolderListInCurrentFolder') or []:
            if call(manager, 'OpenFolder', folder):
                walk(parts + [str(folder)], depth + 1)
                call(manager, 'GotoParentFolder')
    try:
        walk([], 0)
    finally:
        call(manager, 'GotoRootFolder')
        # Restore the project manager folder when it was at the root or one level deep.
        if original_folder and original_folder != call(manager, 'GetCurrentFolder'):
            call(manager, 'OpenFolder', original_folder)
    return {'count': len(found), 'projects': found}, found


def timeline_record(timeline):
    setting = call(timeline, 'GetSetting', 'timelineFrameRate')
    try:
        fps = float(setting)
    except (TypeError, ValueError):
        fps = None
    tracks = []
    durations = []
    fusion = []
    for kind in ('video', 'audio', 'subtitle'):
        count = call(timeline, 'GetTrackCount', kind) or 0
        for index in range(1, min(int(count), 64) + 1):
            items = []
            for item in (call(timeline, 'GetItemListInTrack', kind, index) or [])[:5000]:
                start = call(item, 'GetStart')
                end = call(item, 'GetEnd')
                comps = call(item, 'GetFusionCompNames') or []
                media = call(item, 'GetMediaPoolItem')
                entry = {'name': call(item, 'GetName'), 'start_frame': start, 'end_frame': end,
                         'fusion_compositions': comps, 'source_path': call(media, 'GetClipProperty', 'File Path') if media else None}
                if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start and fps and kind == 'video':
                    entry['duration_seconds'] = round((end - start) / fps, 3)
                    durations.append(entry['duration_seconds'])
                if comps:
                    fusion.append({'clip': entry['name'], 'compositions': comps})
                items.append(entry)
            tracks.append({'kind': kind, 'index': index, 'name': call(timeline, 'GetTrackName', kind, index), 'items': items})
    return {'name': call(timeline, 'GetName'), 'fps': fps, 'tracks': tracks,
            'video_clip_count': len(durations), 'median_video_clip_seconds': round(statistics.median(durations), 3) if durations else None,
            'fusion_evidence': fusion, 'limits': 'Timeline API exposes placement and Fusion composition names; it does not prove visible transition, motion, effect, or exact grade appearance.'}


def inspect_resolve(output, switch=False, max_projects=100):
    from resolve_bridge import scripting_module
    resolve = scripting_module()
    manager = call(resolve, 'GetProjectManager')
    if manager is None:
        raise RuntimeError('Resolve project manager unavailable')
    original = call(manager, 'GetCurrentProject')
    original_name = call(original, 'GetName') if original else None
    library, names = project_names(manager)
    inspected = []
    failures = []
    def inspect(project, folder=''):
        timelines = []
        for index in range(1, min(int(call(project, 'GetTimelineCount') or 0), 100) + 1):
            timeline = call(project, 'GetTimelineByIndex', index)
            if timeline:
                timelines.append(timeline_record(timeline))
        inspected.append({'project': call(project, 'GetName'), 'folder': folder, 'timeline_count': len(timelines), 'timelines': timelines})
    if original:
        inspect(original, 'currently open')
    if switch:
        if original:
            raise RuntimeError('Close the current project in Resolve after saving it before using --switch-projects; no project was switched')
        for entry in names[:max_projects]:
            if not call(manager, 'GotoRootFolder'):
                failures.append({'project': entry['name'], 'error': 'Could not open root folder'})
                break
            if any(not call(manager, 'OpenFolder', part) for part in entry['folder'].split('/') if part):
                failures.append({'project': entry['name'], 'error': 'Could not open project folder'})
                continue
            project = call(manager, 'LoadProject', entry['name'])
            if not project:
                failures.append({'project': entry['name'], 'error': 'Could not load project'})
                continue
            inspect(project, entry['folder'])
            call(manager, 'CloseProject', project)
    result = {'studied_at': now(), 'library': library, 'original_open_project': original_name,
              'inspected': inspected, 'failures': failures,
              'limits': 'Read-only scripting metadata. Resolve may omit transition, OFX, Fusion nodes, keyframes, and grade details. Check exports visually and aurally.'}
    write_json(output / 'video-editor-resolve-study.json', result)
    return result


def probe(path):
    done = subprocess.run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)],
                          capture_output=True, text=True, timeout=45)
    if done.returncode:
        raise RuntimeError(done.stderr[-500:])
    data = json.loads(done.stdout)
    streams = data.get('streams', [])
    video = next((s for s in streams if s.get('codec_type') == 'video'), {})
    audio = next((s for s in streams if s.get('codec_type') == 'audio'), {})
    return {'path': str(path), 'duration_seconds': float(data.get('format', {}).get('duration', 0) or 0),
            'width': video.get('width'), 'height': video.get('height'), 'fps': video.get('avg_frame_rate'),
            'video_codec': video.get('codec_name'), 'audio_codec': audio.get('codec_name'),
            'has_audio': bool(audio), 'size_bytes': path.stat().st_size}


def compare(reference_paths, draft, output):
    references = []
    errors = []
    for path in reference_paths:
        try:
            references.append(probe(path.resolve(strict=True)))
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
            errors.append({'path': str(path), 'error': str(error)[:300]})
    candidate = probe(draft.resolve(strict=True))
    checks = []
    if references:
        geometry = {(x['width'], x['height']) for x in references}
        checks.append({'check': 'dimensions among references', 'pass': (candidate['width'], candidate['height']) in geometry,
                       'candidate': [candidate['width'], candidate['height']], 'reference_values': [list(x) for x in sorted(geometry)]})
        audio_refs = any(x['has_audio'] for x in references)
        checks.append({'check': 'audio present when references have audio', 'pass': bool(candidate['has_audio']) if audio_refs else True})
        durations = [x['duration_seconds'] for x in references if x['duration_seconds'] > 0]
        if durations:
            lower, upper = min(durations) * 0.75, max(durations) * 1.25
            checks.append({'check': 'duration near references', 'pass': lower <= candidate['duration_seconds'] <= upper,
                           'reference_range_seconds': [round(lower, 2), round(upper, 2)]})
    result = {'reviewed_at': now(), 'draft': candidate, 'references': references, 'checks': checks, 'errors': errors,
              'limits': 'These checks catch format or audio regressions only. A human or Claude must compare actual picture, timing, text, transitions, effects, colour, and sound before approval.'}
    write_json(output, result)
    return result


def remember(draft, export_root):
    """Install a reviewed style note while retaining the previous version."""
    text = draft.read_text(encoding='utf-8').strip()
    if len(text) < 100 or len(text) > 100000:
        raise ValueError('Style profile must contain 100 to 100,000 characters')
    export_root.mkdir(parents=True, exist_ok=True)
    profile = export_root / 'video-editor-style-profile.md'
    history = export_root / 'video-editor-style-history'
    history.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    if profile.exists():
        shutil.copy2(profile, history / f'{stamp}-previous.md')
    temporary = profile.with_suffix('.md.tmp')
    temporary.write_text(text + '\n', encoding='utf-8')
    os.replace(temporary, profile)
    shutil.copy2(profile, history / f'{stamp}-current.md')
    return {'profile_path': str(profile), 'history_path': str(history), 'version': stamp}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    inv = commands.add_parser('inventory')
    inv.add_argument('media_root', type=Path)
    inv.add_argument('export_root', type=Path)
    inv.add_argument('--max-files', type=int, default=100000)
    res = commands.add_parser('resolve')
    res.add_argument('export_root', type=Path)
    res.add_argument('--switch-projects', action='store_true')
    res.add_argument('--max-projects', type=int, default=100)
    cmp = commands.add_parser('compare')
    cmp.add_argument('draft', type=Path)
    cmp.add_argument('references', nargs='+', type=Path)
    cmp.add_argument('--output', required=True, type=Path)
    mem = commands.add_parser('remember')
    mem.add_argument('draft', type=Path)
    mem.add_argument('export_root', type=Path)
    args = parser.parse_args()
    if args.command == 'inventory':
        value = scan(args.media_root, args.export_root, args.max_files)
        print(json.dumps({'counts': value['counts'], 'inventory_path': value['inventory_path']}))
    elif args.command == 'resolve':
        value = inspect_resolve(args.export_root, args.switch_projects, args.max_projects)
        print(json.dumps({'project_count': value['library'].get('count'), 'inspected_count': len(value['inspected']),
                          'failures': value['failures'], 'study_path': str(args.export_root / 'video-editor-resolve-study.json')}))
    elif args.command == 'compare':
        value = compare(args.references, args.draft, args.output)
        print(json.dumps({'checks': value['checks'], 'errors': value['errors'], 'report_path': str(args.output)}))
    else:
        print(json.dumps(remember(args.draft, args.export_root)))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f'Style study: {error}', file=sys.stderr)
        raise SystemExit(1) from error
