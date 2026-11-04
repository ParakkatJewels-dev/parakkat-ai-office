#!/usr/bin/env python3
"""Refresh public worker code from the authenticated AI Office package.

The local subscription.env and user assets are never part of the package.
"""
import hashlib
import io
import os
import re
import stat
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
MAX_ARCHIVE_BYTES = 2_000_000
ETAG_FILE = HERE / '.worker-package-etag'
FORBIDDEN = {'subscription.env', 'config.env', '.env', 'auth.json', '.worker-package-etag'}


def settings(file=HERE / 'subscription.env'):
    values = {}
    for raw in file.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key not in {'VIDEO_OFFICE_URL', 'VIDEO_WORKER_TOKEN', 'VIDEO_MEDIA_ROOT', 'VIDEO_EXPORT_ROOT'}:
            raise ValueError('Invalid subscription.env setting')
        values[key] = value.strip().strip('"\'')
    url = values.get('VIDEO_OFFICE_URL', '').rstrip('/')
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('VIDEO_OFFICE_URL must be an HTTPS server URL')
    token = values.get('VIDEO_WORKER_TOKEN', '')
    if len(token) < 32:
        raise ValueError('VIDEO_WORKER_TOKEN is missing')
    return url, token


def safe_members(archive):
    members = []
    seen = set()
    total_size = 0
    for member in archive.infolist():
        if member.is_dir():
            continue
        parts = PurePosixPath(member.filename).parts
        if (len(parts) < 2 or parts[0] != 'video-worker' or
                any(part in ('', '.', '..') for part in parts) or
                '\\' in member.filename or ':' in member.filename or
                parts[-1] in FORBIDDEN or 'node_modules' in parts):
            raise ValueError('Worker package contains an unsafe path')
        relative = Path(*parts[1:])
        if relative in seen:
            raise ValueError('Worker package contains a duplicate path')
        seen.add(relative)
        mode = member.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG):
            raise ValueError('Worker package contains a non-file entry')
        if member.file_size > MAX_ARCHIVE_BYTES:
            raise ValueError('Worker package file is too large')
        total_size += member.file_size
        if len(members) >= 200 or total_size > 5_000_000:
            raise ValueError('Worker package contains too much data')
        members.append((member, relative))
    if not members or Path('update_worker.py') not in seen or Path('channel/office-video.mjs') not in seen:
        raise ValueError('Worker package is incomplete')
    return members


def install_archive(data, expected_sha, root=HERE):
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError('Worker package checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = safe_members(archive)
        with tempfile.TemporaryDirectory(prefix='.worker-update-', dir=root) as temporary:
            stage = Path(temporary)
            for member, relative in members:
                target = stage / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(member))
            for _, relative in members:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                if any((root / Path(*relative.parts[:index])).is_symlink() for index in range(1, len(relative.parts) + 1)):
                    raise ValueError('Worker destination contains a symlink')
                os.replace(stage / relative, target)
    return len(members)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError('Worker package download redirected')


def update():
    url, token = settings()
    headers = {'Authorization': 'Bearer ' + token}
    if ETAG_FILE.exists():
        previous = ETAG_FILE.read_text(encoding='ascii').strip()
        if re.fullmatch(r'"[0-9a-f]{64}"', previous):
            headers['If-None-Match'] = previous
    request = urllib.request.Request(url + '/api/video-worker/download', headers=headers)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        response = opener.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return 'current'
        raise RuntimeError(f'AI Office update HTTP {error.code}') from error
    with response:
        if response.status != 200:
            raise RuntimeError(f'AI Office update HTTP {response.status}')
        etag = response.headers.get('ETag', '')
        if not re.fullmatch(r'"[0-9a-f]{64}"', etag):
            raise ValueError('AI Office package has no valid checksum')
        data = response.read(MAX_ARCHIVE_BYTES + 1)
        if len(data) > MAX_ARCHIVE_BYTES:
            raise ValueError('Worker package exceeds size limit')
    count = install_archive(data, etag[1:-1])
    ETAG_FILE.write_text(etag + '\n', encoding='ascii')
    return f'updated {count} files'


if __name__ == '__main__':
    try:
        print(update())
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        print(f'AI Office worker update: {error}', file=sys.stderr)
        raise SystemExit(1) from error
