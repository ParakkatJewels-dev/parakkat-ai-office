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
CATALOG_LIMIT = 500
PREVIEW_PAGE_SIZE = 50


def preview_page(manifest, manifest_path, offset):
    media = manifest['media']
    if offset < 0 or offset >= len(media) or offset % PREVIEW_PAGE_SIZE:
        raise ValueError(f'Offset must be 0, {PREVIEW_PAGE_SIZE}, {2 * PREVIEW_PAGE_SIZE}, ... within the catalog')
    source = Path(manifest['source_root']).resolve(strict=True)
    batch = media[offset:offset + PREVIEW_PAGE_SIZE]
    for index, item in enumerate(batch, start=offset):
        path = (source / item['file']).resolve(strict=True)
        if not path.is_relative_to(source) or not path.is_file() or path.suffix.lower() not in VIDEO_SUFFIXES:
            raise ValueError('Catalog source file is missing or outside its source folder')
        item['preview_frames'] = thumbnails(path, item['duration'], manifest_path.parent, index)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    next_offset = offset + PREVIEW_PAGE_SIZE if offset + PREVIEW_PAGE_SIZE < len(media) else None
    print(json.dumps({
        'manifest_path': str(manifest_path), 'preview_root': str(manifest_path.parent),
        'total_clips': len(media), 'previewed_offset': offset, 'next_offset': next_offset,
        'media': batch,
        'instruction': 'Review this page of preview frames. If next_offset is present, run inspect-batch MANIFEST_PATH --offset NEXT_OFFSET. The manifest catalogs all source clips; the final plan may use clips from any page.',
    }, indent=2, ensure_ascii=False))


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
    files = media_in(source, max_files=CATALOG_LIMIT)
    media = []
    for path in files:
        item = {'file': str(path.relative_to(source)), **probe(path)}
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
    preview_page(manifest, manifest_path, 0)


def inspect_batch(args):
    manifest_path = Path(args.manifest).expanduser().resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if not isinstance(manifest.get('media'), list) or not 1 <= len(manifest['media']) <= CATALOG_LIMIT:
        raise ValueError('Invalid clip catalog')
    preview_page(manifest, manifest_path, args.offset)


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
    validate_plan(plan, manifest['media'], max_segments=300)
    catalog_count = len(manifest['media'])
    selected = {segment['file'] for segment in plan['segments']}
    manifest['media'] = [item for item in manifest['media'] if item['file'] in selected]
    manifest['catalog_media_count'] = catalog_count
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
    target_format = result.get('target_format')
    if target_format and (info.get('width'), info.get('height')) != (target_format['width'], target_format['height']):
        raise RuntimeError(f'Resolve exported {info.get("width")}x{info.get("height")} instead of {target_format["width"]}x{target_format["height"]}. Inspect {exported} and the Resolve project before retrying.')
    expected = sum(segment['end_seconds'] - segment['start_seconds'] for segment in plan['segments'])
    result['duration_seconds'] = info['duration']
    result['width'] = info.get('width')
    result['height'] = info.get('height')
    result['fps'] = info.get('fps')
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
    batch_parser = commands.add_parser('inspect-batch', help='Generate previews for the next page in a large clip catalog')
    batch_parser.add_argument('manifest', help='manifest.json returned by inspect')
    batch_parser.add_argument('--offset', required=True, type=int, help='next_offset returned by the previous page')
    batch_parser.set_defaults(func=inspect_batch)
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
