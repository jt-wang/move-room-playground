"""doctor names each missing tool with the install command for this platform, so the agent can offer it.

Run from the skill directory: python3 -m unittest discover -s tests
"""
import contextlib, io, sys, unittest
from pathlib import Path
from unittest import mock

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / 'scripts'))
from blender_tour_flow import cli  # noqa: E402


def run_doctor(platform, missing, stills=False, version=(3, 12, 0)):
    def find(name):
        if name in missing: raise ValueError(f'{name} not found on PATH')
        return Path('/bin/true')
    out = io.StringIO()
    with mock.patch.object(cli, 'find_tool', find), mock.patch.object(cli.sys, 'platform', platform), \
         mock.patch.object(cli.sys, 'version_info', version), \
         mock.patch.object(cli.subprocess, 'run', return_value=mock.Mock(stdout='x 1.0\n')), contextlib.redirect_stdout(out):
        code = cli.doctor(stills)
    return code, out.getvalue()


class DoctorInstallHints(unittest.TestCase):
    def test_missing_tools_come_with_this_platforms_install_command(self):
        cases = {
            'darwin': {'blender': 'brew install --cask blender', 'ffmpeg': 'brew install ffmpeg'},
            'linux': {'blender': 'sudo snap install blender --classic', 'ffmpeg': 'sudo apt install ffmpeg'},
            'win32': {'blender': 'winget install -e --id BlenderFoundation.Blender', 'ffmpeg': 'winget install -e --id Gyan.FFmpeg'},
        }
        for platform, commands in cases.items():
            code, text = run_doctor(platform, {'blender', 'ffmpeg', 'ffprobe'})
            self.assertEqual(code, 1, platform)
            for tool, command in commands.items():
                self.assertIn(f'{tool}: MISSING', text)
                self.assertIn(f'install {tool}: {command}', text, platform)
            self.assertIn('install ffprobe: comes with ffmpeg', text)

    def test_present_tools_get_no_install_line(self):
        code, text = run_doctor('darwin', set())
        self.assertEqual(code, 0)
        self.assertNotIn('install ', text)

    def test_python_older_than_3_11_is_missing_with_its_install_command(self):
        code, text = run_doctor('darwin', set(), version=(3, 9, 6))
        self.assertEqual(code, 1)
        self.assertIn('python: MISSING 3.9.6', text)
        self.assertIn('install python: brew install python@3.12', text)
        code, text = run_doctor('linux', set(), version=(3, 12, 1))
        self.assertIn('python: OK 3.12.1', text)

    def test_stills_jobs_never_ask_for_ffmpeg(self):
        code, text = run_doctor('linux', {'ffmpeg', 'ffprobe'}, stills=True)
        self.assertEqual(code, 0)
        self.assertNotIn('install ffmpeg', text)


if __name__ == '__main__':
    unittest.main()
