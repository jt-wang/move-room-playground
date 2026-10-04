"""Localhost-only static server for a build's public allowlist."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from .publish import PUBLIC_FILES, check_public


def resolve_request(public, raw_path):
    """Map a request path to an allowlisted regular file directly inside public."""
    path = urlsplit(raw_path).path
    if path == '/':
        name = 'index.html'
    elif path.startswith('/'):
        name = unquote(path[1:])
    else:
        return None
    if name not in PUBLIC_FILES:
        return None
    p = public / name
    if p.is_symlink() or not p.is_file() or p.resolve().parent != public:
        return None
    return p


class Handler(BaseHTTPRequestHandler):
    server_version = 'room-preview'
    sys_version = ''

    def do_GET(self):
        self._send(body=True)

    def do_HEAD(self):
        self._send(body=False)

    def _send(self, body):
        # Reject foreign Host headers so a rebinding DNS name cannot read the preview.
        if self.headers.get('Host') not in self.server.allowed_hosts:
            self.send_error(403)
            return
        p = resolve_request(self.server.public, self.path)
        if p is None:
            self.send_error(404)
            return
        data = p.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', PUBLIC_FILES[p.name])
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        if body:
            self.wfile.write(data)

    def log_message(self, *args):
        pass


def make_server(public):
    """Bind 127.0.0.1 on a free port chosen by the OS."""
    public = check_public(public)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.public = public
    port = server.server_port
    server.allowed_hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
    return server
