#!/usr/bin/env python3
"""Local Resolve edit commands for an interactive Claude Code Remote Control session.

This does not call Claude or the AI Office server. The signed-in Claude Code session
chooses the edit plan, then invokes this script to render it on the editing PC.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from worker import VIDEO_SUFFIXES, media_in, probe, thumbnails, validate_plan

HERE = Path(__file__).resolve().parent
SAFE_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')


def inspect(args):
    source = Path(args.source).expanduser().resolve(strict=True)
    if not source.is_dir():
        raise ValueError('The source path must be a folder')
    if not SAFE_NAME.fullmatch(args.output_name) or args.output_name in ('.', '..'):
        raise ValueError('Output name must use only letters, numbers, dots, dashes, or underscores')
    output = Path(args.output_root).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    output = output.resolve(strict=True)
    job_id = uuid.uuid4().hex[:12]
    scratch = output / '_remote_jobs' / job_id
    scratch.mkdir(parents=True, exist_ok=False)
    files = media_in(source)
    media = []
    for index, path in enumerate(files):
        item = {'file': str(path.relative_to(source)), **probe(path)}
        item['preview_frames'] = thumbnails(path, item['duration'], scratch, index)
        media.append(item)
    manifest = {
        'job_id': job_id,
        'brief': args.brief,
        'source_root': str(source),
        'output_root': str(output),
        'output_name': args.output_name,
        'media': media,
    }
    manifest_path = scratch / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'manifest_path': str(manifest_path), 'preview_root': str(scratch), 'media': media}, indent=2, ensure_ascii=False))


def render(args):
    manifest_path = Path(args.manifest).expanduser().resolve(strict=True)
    plan_path = Path(args.plan).expanduser().resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    plan = json.loads(plan_path.read_text(encoding='utf-8'))
    source = Path(manifest['source_root']).resolve(strict=True)
    output = Path(manifest['output_root']).resolve(strict=True)
    if not source.is_dir() or not output.is_dir():
        raise ValueError('Source or output folder is missing')
    if not SAFE_NAME.fullmatch(manifest['output_name']) or manifest['output_name'] in ('.', '..'):
        raise ValueError('Invalid output name in manifest')
    for item in manifest['media']:
        file_path = (source / item['file']).resolve(strict=True)
        if not file_path.is_relative_to(source) or not file_path.is_file() or file_path.suffix.lower() not in VIDEO_SUFFIXES:
            raise ValueError('Source file in manifest is missing or outside the source folder')
    validate_plan(plan, manifest['media'])
    manifest['plan'] = plan
    render_manifest = manifest_path.parent / 'render-manifest.json'
    if render_manifest.exists():
        raise FileExistsError('This edit has already been submitted to Resolve; inspect the project before trying again')
    render_manifest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    bridge = Path(os.environ.get('VIDEO_BRIDGE_SCRIPT', str(HERE / 'resolve_bridge.py'))).expanduser().resolve(strict=True)
    done = subprocess.run([sys.executable, str(bridge), str(render_manifest)], cwd=manifest_path.parent, capture_output=True, text=True, timeout=7200)
    if done.returncode:
        raise RuntimeError((done.stderr or done.stdout or 'Resolve editing failed')[-2000:])
    result = json.loads(done.stdout)
    for field in ('project_path', 'export_path'):
        path = Path(result[field]).resolve(strict=True)
        if not path.is_relative_to(output) or not path.is_file() or path.stat().st_size < 1024:
            raise RuntimeError(f'Resolve returned an invalid {field}')
    exported = Path(result['export_path'])
    info = probe(exported)
    expected = sum(segment['end_seconds'] - segment['start_seconds'] for segment in plan['segments'])
    result['duration_seconds'] = info['duration']
    result['planned_duration_seconds'] = round(expected, 3)
    result['summary'] = plan.get('summary', '')
    result_path = manifest_path.parent / 'result.json'
    result_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(result, indent=2, ensure_ascii=False))


def check(_args):
    for program in ('ffmpeg', 'ffprobe'):
        if not shutil.which(program):
            raise RuntimeError(f'{program} is not on PATH')
    from resolve_bridge import scripting_module
    resolve = scripting_module()
    version = resolve.GetVersionString() if hasattr(resolve, 'GetVersionString') else 'available'
    print(f'Local editing ready: DaVinci Resolve {version}, FFmpeg, FFprobe')


def main():
    parser = argparse.ArgumentParser(description='Inspect and render local videos in DaVinci Resolve with Claude Code Remote Control')
    commands = parser.add_subparsers(dest='command', required=True)
    check_parser = commands.add_parser('check', help='Check Resolve and FFmpeg without any API key')
    check_parser.set_defaults(func=check)
    inspect_parser = commands.add_parser('inspect', help='Probe source videos and create preview frames')
    inspect_parser.add_argument('source', help='Folder containing source videos')
    inspect_parser.add_argument('--output-root', required=True, help='Folder for exports and scratch previews')
    inspect_parser.add_argument('--output-name', required=True, help='Short name for the output files')
    inspect_parser.add_argument('--brief', required=True, help='The edit request')
    inspect_parser.set_defaults(func=inspect)
    render_parser = commands.add_parser('render', help='Validate a JSON edit plan and render through Resolve')
    render_parser.add_argument('manifest', help='manifest.json returned by inspect')
    render_parser.add_argument('--plan', required=True, help='JSON file containing summary and segments')
    render_parser.set_defaults(func=render)
    args = parser.parse_args()
    try:
        args.func(args)
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired, KeyError, json.JSONDecodeError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == '__main__':
    main()
