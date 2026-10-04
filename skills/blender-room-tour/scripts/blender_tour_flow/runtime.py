"""Locate installed tools and run trusted recipe code in background Blender.

Nothing here installs, downloads, or upgrades software.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
SCRIPTS = PACKAGE.parent
ASSETS = PACKAGE / 'assets'
# Optional convenience fallback only; PATH or BLENDER_BIN take precedence.
MAC_BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'

TOOLS = {
    'ffmpeg': ('FFMPEG_BIN', ()),
    'ffprobe': ('FFPROBE_BIN', ()),
    'blender': ('BLENDER_BIN', (MAC_BLENDER,) if sys.platform == 'darwin' else ()),
}


def _executable(path):
    return path.is_file() and os.access(path, os.X_OK)


def find_tool(name):
    """Explicit env var, then PATH, then a standard application fallback."""
    env_var, fallbacks = TOOLS[name]
    explicit = os.environ.get(env_var)
    if explicit:
        path = Path(explicit).expanduser()
        if not _executable(path):
            raise ValueError(f'{env_var} is not an executable file: {explicit}')
        return path.resolve()
    found = shutil.which(name)
    if found:
        return Path(found).resolve()
    for candidate in fallbacks:
        if _executable(Path(candidate)):
            return Path(candidate)
    raise ValueError(f'{name} not found on PATH; set {env_var}. Nothing is installed automatically.')


def run_blender(blender, script, args, timeout, log_path):
    """Run one background Blender process; on timeout stop only that process."""
    cmd = [str(blender), '--background', '--factory-startup',
           '--python-exit-code', '1', '--python', str(script), '--', *map(str, args)]
    with open(log_path, 'w') as log:
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            raise RuntimeError(f'Blender exceeded {timeout:g}s and was stopped; see {log_path}') from None
        except BaseException:
            proc.kill()
            proc.wait()
            raise
    if code != 0:
        tail = ''.join(Path(log_path).read_text(errors='replace').splitlines(True)[-15:])
        raise RuntimeError(f'Blender exited with {code}; see {log_path}\n{tail}')
