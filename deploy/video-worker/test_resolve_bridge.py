import unittest

from resolve_bridge import edit_format


class ResolveFormatTests(unittest.TestCase):
    def test_vertical_dji_sources_choose_vertical_native_rate(self):
        data = {
            'brief': 'Connection test',
            'media': [{'file': 'clip.mp4', 'width': 1512, 'height': 2688, 'fps': '60000/1001'}],
            'plan': {'segments': [{'file': 'clip.mp4', 'start_seconds': 0, 'end_seconds': 2}]},
        }
        self.assertEqual(edit_format(data), {'width': 1080, 'height': 1920, 'fps': 59.94})

    def test_explicit_landscape_request_overrides_mixed_source_geometry(self):
        data = {
            'brief': 'Make a horizontal video',
            'media': [{'file': 'clip.mp4', 'width': 1512, 'height': 2688, 'fps': '30/1'}],
            'plan': {'segments': [{'file': 'clip.mp4', 'start_seconds': 0, 'end_seconds': 2}]},
        }
        self.assertEqual(edit_format(data), {'width': 1920, 'height': 1080, 'fps': 30})


if __name__ == '__main__':
    unittest.main()
