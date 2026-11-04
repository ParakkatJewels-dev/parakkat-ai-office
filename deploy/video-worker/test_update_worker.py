import hashlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from update_worker import install_archive


def package(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    data = buffer.getvalue()
    return data, hashlib.sha256(data).hexdigest()


class WorkerUpdateTests(unittest.TestCase):
    def test_updates_code_and_preserves_private_settings(self):
        data, digest = package({
            'video-worker/update_worker.py': 'new updater',
            'video-worker/channel/office-video.mjs': 'new channel',
            'video-worker/EDITING_GUIDE.md': 'new guide',
        })
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'subscription.env').write_text('private token')
            self.assertEqual(install_archive(data, digest, root), 3)
            self.assertEqual((root / 'subscription.env').read_text(), 'private token')
            self.assertEqual((root / 'EDITING_GUIDE.md').read_text(), 'new guide')

    def test_rejects_traversal_and_private_settings(self):
        for bad in ('video-worker/../outside.txt', 'video-worker/subscription.env', 'video-worker/node_modules/x.js'):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as folder:
                data, digest = package({
                    'video-worker/update_worker.py': 'safe',
                    'video-worker/channel/office-video.mjs': 'safe',
                    bad: 'unsafe',
                })
                with self.assertRaises(ValueError):
                    install_archive(data, digest, Path(folder))

    def test_rejects_changed_package(self):
        data, digest = package({'video-worker/update_worker.py': 'safe', 'video-worker/channel/office-video.mjs': 'safe'})
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                install_archive(data + b'changed', digest, Path(folder))


if __name__ == '__main__':
    unittest.main()
