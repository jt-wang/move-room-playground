"""Exercise the CLI/API budget through the real process wrapper with simulated time.

The fake child finishes a 40-minute render without making the test sleep. A
deliberately short caller limit must still kill only that child and retain the
failed build. No success receipt or real Blender output is fabricated.
"""
import contextlib, io, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from blender_tour_flow import cli, runtime


class RenderCompleted(Exception):
    pass


class BuildTimeout(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.job = Path(self.tmp.name) / 'job'
        cli.example(self.job)
        self.child = mock.Mock()
        self.elapsed = 40 * 60
        def wait(timeout=None):
            if timeout is not None and timeout < self.elapsed:
                raise subprocess.TimeoutExpired('simulated-blender', timeout)
            return 0
        self.child.wait.side_effect = wait
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(cli, 'find_tool', return_value=Path('/installed/blender')).start()
        mock.patch.object(runtime.subprocess, 'Popen', return_value=self.child).start()
        def render(*args):
            runtime.run_blender(*args)
            # Stop before export validation. A simulated child cannot create
            # genuine Blender artifacts or claim a successful build.
            raise RenderCompleted()
        mock.patch.object(cli, 'run_blender', side_effect=render).start()

    def test_plain_cli_build_allows_a_forty_minute_render(self):
        with self.assertRaises(RenderCompleted):
            cli.main(['build', str(self.job)])
        self.child.kill.assert_not_called()

    def test_python_api_default_allows_a_forty_minute_render(self):
        with self.assertRaises(RenderCompleted):
            cli.build(self.job)
        self.child.kill.assert_not_called()

    def test_explicit_short_limit_still_stops_child_and_preserves_failure(self):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            result = cli.main(['build', str(self.job), '--timeout', '1800'])
        self.assertEqual(result, 1)
        self.child.kill.assert_called_once()
        self.assertIn('Blender exceeded 1800s', err.getvalue())
        self.assertEqual(len(list((self.job / 'builds').glob('*/failure.json'))), 1)
        self.assertFalse((self.job / 'state.json').exists())

    def test_caller_can_choose_a_longer_total_budget(self):
        self.elapsed = 150 * 60
        with self.assertRaises(RenderCompleted):
            cli.main(['build', str(self.job), '--timeout', '10800'])
        self.child.kill.assert_not_called()


if __name__ == '__main__':
    unittest.main()
