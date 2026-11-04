import tempfile
import unittest
from pathlib import Path

from worker import confined_folder, media_in, validate_plan

class WorkerSafetyTest(unittest.TestCase):
    def test_source_folder_stays_under_media_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = (Path(temporary) / 'media').resolve()
            (root / 'Launch').mkdir(parents=True)
            self.assertEqual(confined_folder(root, 'Launch'), root / 'Launch')
            with self.assertRaises(ValueError): confined_folder(root, '..')
            outside = Path(temporary) / 'elsewhere'
            outside.mkdir()
            (root / 'link').symlink_to(outside)
            with self.assertRaises(ValueError): confined_folder(root, 'link')

    def test_media_symlinks_and_invalid_plan_cannot_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / 'inside.mov').write_bytes(b'video')
            (root / 'outside.mp4').symlink_to(Path('/tmp/outside.mp4'))
            self.assertEqual([p.name for p in media_in(root)], ['inside.mov'])
            media = [{'file': 'inside.mov', 'duration': 5.0}]
            validate_plan({'segments': [{'file': 'inside.mov', 'start_seconds': 0, 'end_seconds': 4.9}]}, media)
            for segment in [
                {'file': '../outside.mp4', 'start_seconds': 0, 'end_seconds': 3},
                {'file': 'inside.mov', 'start_seconds': -1, 'end_seconds': 3},
                {'file': 'inside.mov', 'start_seconds': 0, 'end_seconds': 50},
            ]:
                with self.assertRaises(ValueError): validate_plan({'segments': [segment]}, media)

if __name__ == '__main__': unittest.main()
