#!/usr/bin/env python3
"""Local Resolve edit commands for an interactive Claude Code Remote Control session.

This does not call Claude or the AI Office server. The signed-in Claude Code session
chooses the edit plan, then invokes this script to render it on the editing PC.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import uuid
from fractions import Fraction
from pathlib import Path

from worker import VIDEO_SUFFIXES, media_in, probe, thumbnails, validate_plan

HERE = Path(__file__).resolve().parent
SAFE_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
CATALOG_LIMIT = 500
PREVIEW_PAGE_SIZE = 50
AUDIO_SUFFIXES = {'.mp3', '.wav', '.m4a', '.flac', '.aac', '.aiff'}
CARD_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}
SUPPORTED_FRAME_RATES = {23.976, 24, 25, 29.97, 30, 50, 59.94, 60}


def validate_grade(grade):
    if grade is None:
        return
    if not isinstance(grade, dict) or set(grade) != {'slope', 'offset', 'power', 'saturation'}:
        raise ValueError('Grade must contain slope, offset, power, and saturation')
    for name, low, high in (('slope', 0.5, 1.5), ('offset', -0.2, 0.2), ('power', 0.5, 1.5)):
        values = grade[name]
        if not isinstance(values, list) or len(values) != 3 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not low <= v <= high for v in values):
            raise ValueError(f'Grade {name} must be three finite values from {low} to {high}')
    saturation = grade['saturation']
    if isinstance(saturation, bool) or not isinstance(saturation, (int, float)) or not math.isfinite(saturation) or not 0 <= saturation <= 2:
        raise ValueError('Grade saturation must be a finite number from 0 to 2')


def validate_fps(fps):
    if fps is not None and (isinstance(fps, bool) or not isinstance(fps, (int, float)) or fps not in SUPPORTED_FRAME_RATES):
        raise ValueError('Frame rate must be one of 23.976, 24, 25, 29.97, 30, 50, 59.94, or 60')


def validate_audio(audio, duration):
    if audio is None:
        return
    if not isinstance(audio, dict) or set(audio) - {'music', 'sound_effects'}:
        raise ValueError('Audio plan may contain music and sound_effects only')
    effects = audio.get('sound_effects', [])
    if not isinstance(effects, list) or len(effects) > 16:
        raise ValueError('Audio plan may contain up to 16 sound effects')
    choices = ([audio['music']] if 'music' in audio else []) + effects
    if not choices:
        raise ValueError('Audio plan has no clips')
    for choice in choices:
        if not isinstance(choice, dict) or not isinstance(choice.get('file'), str):
            raise ValueError('Audio clip needs a local file path')
        path = Path(choice['file']).expanduser().resolve(strict=True)
        if not path.is_file() or path.suffix.lower() not in AUDIO_SUFFIXES or path.stat().st_size > 100_000_000:
            raise ValueError('Audio clip must be a local supported audio file under 100 MB')
        at = choice.get('at_seconds', 0)
        gain = choice.get('gain_db', 0)
        if isinstance(at, bool) or not isinstance(at, (int, float)) or not math.isfinite(at) or not 0 <= at < duration:
            raise ValueError('Audio start must be within the edit')
        if isinstance(gain, bool) or not isinstance(gain, (int, float)) or not math.isfinite(gain) or not -30 <= gain <= 6:
            raise ValueError('Audio gain must be from -30 to +6 dB')
        if 'source_url' in choice and (not isinstance(choice['source_url'], str) or len(choice['source_url']) > 500):
            raise ValueError('Audio source URL is invalid')


def validate_end_card(card):
    if card is None:
        return 0.0
    if not isinstance(card, dict) or set(card) - {'file', 'duration_seconds', 'background'}:
        raise ValueError('End card may contain file, duration_seconds, and background only')
    file = card.get('file')
    if not isinstance(file, str):
        raise ValueError('End card needs a local image path')
    path = Path(file).expanduser().resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in CARD_SUFFIXES or path.stat().st_size > 20_000_000:
        raise ValueError('End card must be a local PNG, JPEG, or WebP under 20 MB')
    duration = card.get('duration_seconds')
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 1 <= duration <= 10:
        raise ValueError('End card duration must be 1 to 10 seconds')
    if card.get('background', 'white') not in ('white', 'black'):
        raise ValueError('End card background must be white or black')
    return float(duration)


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
    validate_grade(plan.get('grade'))
    for segment in plan['segments']:
        validate_grade(segment.get('grade'))
    validate_fps(plan.get('fps'))
    card_duration = validate_end_card(plan.get('end_card'))
    planned_duration = sum(segment['end_seconds'] - segment['start_seconds'] for segment in plan['segments']) + card_duration
    validate_audio(plan.get('audio'), planned_duration)
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
    if plan.get('fps') is not None:
        try:
            actual_fps = float(Fraction(str(info.get('fps'))))
        except (TypeError, ValueError, ZeroDivisionError):
            actual_fps = None
        if actual_fps is None or abs(actual_fps - plan['fps']) > 0.15:
            raise RuntimeError(f'Resolve exported at {info.get("fps")} fps instead of the requested {plan["fps"]} fps. Inspect {exported} and the Resolve project before retrying.')
    if plan.get('audio'):
        measured = subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-i', str(exported), '-map', '0:a:0',
                                   '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True, timeout=120)
        match = re.search(r'max_volume:\s*(-?\d+(?:\.\d+)?) dB', measured.stderr)
        if measured.returncode or not match or float(match.group(1)) < -60:
            raise RuntimeError(f'The export has no audible audio. Inspect {exported} and the Resolve project before retrying.')
        result['audio_max_dbfs'] = float(match.group(1))
    expected = planned_duration
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
