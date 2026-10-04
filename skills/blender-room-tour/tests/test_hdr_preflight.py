"""HDR failures must explain the selected dependency before creating a job."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from blender_tour_flow.prepare import prepare


class HDRPreflight(unittest.TestCase):
    def test_pq_hlg_and_dolby_reject_missing_filters_without_partial_job(self):
        for tags in ({'color_transfer': 'smpte2084'},
                     {'color_transfer': 'arib-std-b67'},
                     {'side_data_list': [{'side_data_type': 'DOVI configuration record'}]}):
            with self.subTest(tags=tags), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                source = root / 'input.mp4'; source.write_bytes(b'private-source-unchanged')
                tool = root / 'ffmpeg'; tool.write_text('#!/bin/sh\nexit 0\n'); tool.chmod(0o755)
                out = root / 'new-job'
                probe = {'format': {'duration': '1'}, 'streams': [{'codec_type': 'video', **tags}]}
                responses = [subprocess.CompletedProcess([], 0, json.dumps(probe), ''),
                             subprocess.CompletedProcess([], 0, ' .S tonemap V->V conversion\n', '')]
                with mock.patch('blender_tour_flow.prepare.subprocess.run', side_effect=responses) as run:
                    with self.assertRaisesRegex(ValueError, 'Set FFMPEG_BIN and FFPROBE_BIN'):
                        prepare(source, out, tool, tool)
                self.assertEqual(run.call_count, 2)
                self.assertFalse(out.exists())
                self.assertEqual(source.read_bytes(), b'private-source-unchanged')

    def test_mentions_of_filter_are_not_capability(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); source = root / 'input.mp4'; source.write_bytes(b'unchanged')
            tool = root / 'ffmpeg'; tool.write_text('#!/bin/sh\nexit 0\n'); tool.chmod(0o755)
            probe = {'format': {'duration': '1'}, 'streams': [{'codec_type': 'video', 'color_transfer': 'smpte2084'}]}
            responses = [subprocess.CompletedProcess([], 0, json.dumps(probe), ''),
                         subprocess.CompletedProcess([], 0, 'configuration: zscale tonemap unavailable\n', '')]
            with mock.patch('blender_tour_flow.prepare.subprocess.run', side_effect=responses):
                with self.assertRaisesRegex(ValueError, 'tonemap, zscale'):
                    prepare(source, root / 'job', tool, tool)
            self.assertFalse((root / 'job').exists())
