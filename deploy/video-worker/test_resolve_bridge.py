import unittest
import math
import shutil
import struct
import tempfile
import wave
from pathlib import Path
from unittest.mock import patch

from resolve_bridge import add_audio, audio_source_end_frame, clip_fps, edit_format, prepare_audio


class ResolveFormatTests(unittest.TestCase):
    def test_audio_source_range_uses_media_rate_not_timeline_rate(self):
        class AudioClip:
            def GetClipProperty(self, name):
                self_name = name
                return '24' if self_name == 'FPS' else None
        self.assertEqual(clip_fps(AudioClip(), 'music'), 24)
        self.assertEqual(audio_source_end_frame(120, 24), 2879)
        self.assertNotEqual(audio_source_end_frame(120, 24), 120 * 30 - 1)

    def test_audio_placement_uses_source_rate_and_verifies_timeline_duration(self):
        class Clip:
            def GetClipProperty(self, name):
                return '24' if name == 'FPS' else None
        class Timeline:
            def GetStartFrame(self): return 0
            def AddTrack(self, *_args): return True
            def GetTrackCount(self, _kind): return 1
        class Storage:
            def AddItemListToMediaPool(self, _paths): return [Clip()]
        class Placed:
            def GetDuration(self): return 30
        class Pool:
            def __init__(self): self.entry = None
            def AppendToTimeline(self, entries):
                self.entry = entries[0]
                return [Placed()]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'music.wav'
            source.write_bytes(b'fixture')
            def fake_prepare(_source, destination, _duration, _gain_db, music=False):
                destination.parent.mkdir(parents=True, exist_ok=True)
                with wave.open(str(destination), 'wb') as wav:
                    wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(48000)
                    wav.writeframes(b'\0' * 48000 * 4)
            pool = Pool()
            data = {'plan': {'segments': [{'start_seconds': 0, 'end_seconds': 1}],
                             'audio': {'music': {'file': str(source)}}}}
            with patch('resolve_bridge.prepare_audio', side_effect=fake_prepare):
                add_audio(data, Timeline(), pool, Storage(), root / 'assets', {'fps': 30})
            self.assertEqual(pool.entry['endFrame'], 23)
            self.assertEqual(pool.entry['recordFrame'], 0)

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
