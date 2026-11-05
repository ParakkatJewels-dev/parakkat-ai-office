import json
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import remote_edit


class RemoteEditTest(unittest.TestCase):
    def test_grade_values_must_be_bounded(self):
        remote_edit.validate_grade({'slope': [1.02, 1.02, 1.02], 'offset': [0, 0, 0], 'power': [1, 1, 1], 'saturation': 0.98})
        with self.assertRaises(ValueError):
            remote_edit.validate_grade({'slope': [10, 1, 1], 'offset': [0, 0, 0], 'power': [1, 1, 1], 'saturation': 0.98})
        with self.assertRaises(ValueError):
            remote_edit.validate_grade({'slope': [1, 1, 1], 'offset': [0, 0, 0], 'power': [1, 1, 1], 'saturation': float('nan')})

    def test_reference_frame_rate_is_limited_to_supported_values(self):
        remote_edit.validate_fps(24)
        remote_edit.validate_fps(29.97)
        with self.assertRaises(ValueError):
            remote_edit.validate_fps(41)

    def test_end_card_requires_local_image_and_bounded_duration(self):
        with tempfile.TemporaryDirectory() as folder:
            logo = Path(folder) / 'logo.png'
            logo.write_bytes(b'png fixture')
            self.assertEqual(remote_edit.validate_end_card({'file': str(logo), 'duration_seconds': 3}), 3)
            with self.assertRaises(ValueError):
                remote_edit.validate_end_card({'file': str(logo), 'duration_seconds': 30})

    def test_audio_plan_checks_local_asset_and_timing(self):
        with tempfile.TemporaryDirectory() as folder:
            track = Path(folder) / 'music.mp3'
            track.write_bytes(b'example')
            remote_edit.validate_audio({'music': {'file': str(track), 'at_seconds': 0, 'gain_db': -3}}, 10)
            with self.assertRaises(ValueError):
                remote_edit.validate_audio({'sound_effects': [{'file': str(track), 'at_seconds': 11}]}, 10)

    def test_inspect_and_render_local_without_api_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'sources'
            source.mkdir()
            (source / 'clip.mp4').write_bytes(b'clip')
            exports = root / 'exports'
            inspect_args = type('Args', (), {
                'source': str(source), 'output_root': str(exports),
                'output_name': 'sample', 'brief': 'Make a short cut',
            })()
            with patch.object(remote_edit, 'probe', return_value={'duration': 5.0, 'width': 1920, 'height': 1080, 'fps': '30/1'}), \
                 patch.object(remote_edit, 'thumbnails', return_value=['frame.jpg']):
                remote_edit.inspect(inspect_args)
            manifest_path = next(exports.glob('_remote_jobs/*/manifest.json'))
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest['media'][0]['file'], 'clip.mp4')
            self.assertEqual(manifest['brief'], 'Make a short cut')
            plan_path = manifest_path.parent / 'plan.json'
            plan_path.write_text(json.dumps({'summary': 'Short cut', 'segments': [
                {'file': 'clip.mp4', 'start_seconds': 0, 'end_seconds': 3}
            ]}))
            render_args = type('Args', (), {'manifest': str(manifest_path), 'plan': str(plan_path)})()

            def fake_bridge(command, **_kwargs):
                bridge_manifest = json.loads(Path(command[-1]).read_text())
                self.assertEqual(bridge_manifest['plan']['segments'][0]['end_seconds'], 3)
                project = exports / 'sample.drp'
                video = exports / 'sample.mp4'
                project.write_bytes(b'project' * 200)
                video.write_bytes(b'video' * 300)
                return type('Done', (), {'returncode': 0, 'stdout': json.dumps({
                    'project_path': str(project), 'export_path': str(video),
                }), 'stderr': ''})()

            with patch.object(remote_edit.subprocess, 'run', side_effect=fake_bridge), \
                 patch.object(remote_edit, 'probe', return_value={'duration': 3.0}):
                remote_edit.render(render_args)
            result = json.loads((manifest_path.parent / 'result.json').read_text())
            self.assertEqual(result['planned_duration_seconds'], 3)
            self.assertEqual(result['duration_seconds'], 3.0)
            with self.assertRaises(FileExistsError):
                remote_edit.render(render_args)

    def test_plan_cannot_name_another_source_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'sources'
            source.mkdir()
            (source / 'clip.mp4').write_bytes(b'clip')
            exports = root / 'exports'
            exports.mkdir()
            job = exports / '_remote_jobs' / 'job'
            job.mkdir(parents=True)
            manifest_path = job / 'manifest.json'
            manifest_path.write_text(json.dumps({
                'job_id': 'job', 'brief': 'test', 'source_root': str(source),
                'output_root': str(exports), 'output_name': 'safe',
                'media': [{'file': 'clip.mp4', 'duration': 5.0}],
            }))
            plan_path = job / 'plan.json'
            plan_path.write_text(json.dumps({'summary': '', 'segments': [
                {'file': '../other.mp4', 'start_seconds': 0, 'end_seconds': 3}
            ]}))
            args = type('Args', (), {'manifest': str(manifest_path), 'plan': str(plan_path)})()
            with self.assertRaises(ValueError):
                remote_edit.render(args)
            self.assertFalse((job / 'render-manifest.json').exists())

    def test_large_folder_previews_in_pages_and_imports_only_selected_clips(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'sources'
            source.mkdir()
            for number in range(150):
                (source / f'clip-{number:03d}.mp4').write_bytes(b'clip')
            exports = root / 'exports'
            args = type('Args', (), {
                'source': str(source), 'output_root': str(exports),
                'output_name': 'large-edit', 'brief': 'Choose the strongest shots',
            })()
            calls = []

            def fake_thumbnails(path, _duration, _scratch, number):
                calls.append(number)
                return [f'clip-{number:03d}-preview.jpg']

            output = io.StringIO()
            with patch.object(remote_edit, 'probe', return_value={'duration': 5.0, 'width': 1920, 'height': 1080, 'fps': '30/1'}), \
                 patch.object(remote_edit, 'thumbnails', side_effect=fake_thumbnails), redirect_stdout(output):
                remote_edit.inspect(args)
                first = json.loads(output.getvalue())
                self.assertEqual(first['total_clips'], 150)
                self.assertEqual(first['next_offset'], 50)
                self.assertEqual(calls, list(range(50)))
                manifest_path = Path(first['manifest_path'])
                for offset, next_expected in ((50, 100), (100, None)):
                    output.seek(0); output.truncate(0)
                    remote_edit.inspect_batch(type('Args', (), {'manifest': str(manifest_path), 'offset': offset})())
                    self.assertEqual(json.loads(output.getvalue())['next_offset'], next_expected)
            self.assertEqual(calls, list(range(150)))
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(len(manifest['media']), 150)
            remote_edit.validate_plan({'segments': [
                {'file': f'clip-{number:03d}.mp4', 'start_seconds': 0, 'end_seconds': 1}
                for number in range(150)
            ]}, manifest['media'], max_segments=300)
            plan_path = manifest_path.parent / 'plan.json'
            plan_path.write_text(json.dumps({'summary': 'Best final clip', 'segments': [
                {'file': 'clip-149.mp4', 'start_seconds': 0, 'end_seconds': 3}
            ]}))

            def fake_bridge(command, **_kwargs):
                bridge_manifest = json.loads(Path(command[-1]).read_text())
                self.assertEqual(bridge_manifest['catalog_media_count'], 150)
                self.assertEqual([item['file'] for item in bridge_manifest['media']], ['clip-149.mp4'])
                project = exports / 'large-edit.drp'
                video = exports / 'large-edit.mp4'
                project.write_bytes(b'project' * 200)
                video.write_bytes(b'video' * 300)
                return type('Done', (), {'returncode': 0, 'stdout': json.dumps({
                    'project_path': str(project), 'export_path': str(video),
                }), 'stderr': ''})()

            with patch.object(remote_edit.subprocess, 'run', side_effect=fake_bridge), \
                 patch.object(remote_edit, 'probe', return_value={'duration': 3.0}), redirect_stdout(io.StringIO()):
                remote_edit.render(type('Args', (), {'manifest': str(manifest_path), 'plan': str(plan_path)})())


if __name__ == '__main__':
    unittest.main()
