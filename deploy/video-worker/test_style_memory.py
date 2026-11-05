import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from style_memory import compare, remember, scan


class StyleMemoryTests(unittest.TestCase):
    def test_inventory_and_version_history_preserve_previous_profile(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            media = root / 'media'
            media.mkdir()
            (media / 'clip.mp4').write_bytes(b'video')
            output = root / 'exports'
            result = scan(media, output)
            self.assertEqual(result['counts']['video'], 1)
            draft = root / 'draft.md'
            draft.write_text('Reference: clip.mp4\n' + 'Observed cut lengths and colour from the export. ' * 3)
            remember(draft, output)
            draft.write_text('Reference: clip.mp4\n' + 'Reviewed revised cut lengths and colour. ' * 3)
            remember(draft, output)
            self.assertEqual(len(list((output / 'video-editor-style-history').glob('*.md'))), 3)

    def test_compare_flags_frame_rate_mismatch(self):
        reference = {'path': 'reference.mp4', 'width': 1080, 'height': 1920, 'fps': '24/1',
                     'duration_seconds': 30, 'has_audio': True}
        draft = {**reference, 'path': 'draft.mp4', 'fps': '60000/1001'}
        with tempfile.TemporaryDirectory() as folder, patch('style_memory.probe', side_effect=[reference, draft]):
            root = Path(folder)
            for name in ('reference.mp4', 'draft.mp4'):
                (root / name).write_bytes(b'x')
            result = compare([root / 'reference.mp4'], root / 'draft.mp4', root / 'review.json')
            rate_check = next(item for item in result['checks'] if item['check'] == 'frame rate near a reference')
            self.assertFalse(rate_check['pass'])


if __name__ == '__main__':
    unittest.main()
