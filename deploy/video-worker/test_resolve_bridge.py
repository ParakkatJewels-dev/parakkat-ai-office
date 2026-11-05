import unittest
import math
import shutil
import struct
import tempfile
import wave
from pathlib import Path

from resolve_bridge import edit_format, prepare_audio


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

    def test_reference_frame_rate_can_override_source_rate(self):
        data = {
            'brief': 'Make a vertical resort reel',
            'media': [{'file': 'clip.mp4', 'width': 1512, 'height': 2688, 'fps': '60000/1001'}],
            'plan': {'fps': 24, 'segments': [{'file': 'clip.mp4', 'start_seconds': 0, 'end_seconds': 2}]},
        }
        self.assertEqual(edit_format(data), {'width': 1080, 'height': 1920, 'fps': 24})

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg is required')
    def test_music_is_prepared_to_fit_the_edit(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.wav'
            destination = Path(folder) / 'audio' / 'music.wav'
            with wave.open(str(source), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(48000)
                output.writeframes(b''.join(struct.pack('<h', int(10000 * math.sin(2 * math.pi * 440 * i / 48000))) for i in range(48000)))
            prepare_audio(source, destination, 2.0, 0, music=True)
            with wave.open(str(destination), 'rb') as prepared:
                self.assertEqual(prepared.getnchannels(), 2)
                self.assertAlmostEqual(prepared.getnframes() / prepared.getframerate(), 2.0, places=2)


if __name__ == '__main__':
    unittest.main()
