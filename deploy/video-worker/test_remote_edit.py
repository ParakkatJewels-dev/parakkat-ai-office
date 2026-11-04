import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import remote_edit


class RemoteEditTest(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
