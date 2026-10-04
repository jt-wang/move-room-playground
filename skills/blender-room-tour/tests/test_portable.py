"""Standard-library checks for paths, review gates, contract, and the public boundary.

Run from the skill directory: python3 -m unittest discover -s tests
Needs no Blender or FFmpeg; the Blender build itself is covered by the smoke commands.
"""
import hashlib, http.client, json, os, shutil, struct, subprocess, sys, tempfile, threading, unittest
from pathlib import Path
from unittest import mock

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / 'scripts'))
from blender_tour_flow import cli, contract, prepare, publish, runtime, server  # noqa: E402


def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def fake_exe(folder, name):
    p = Path(folder) / name; p.write_text('#!/bin/sh\nexit 0\n'); p.chmod(0o755); return p


def make_glb(doc, binary=b'\0\0\0\0'):
    body = json.dumps(doc).encode(); body += b' ' * (-len(body) % 4)
    chunks = struct.pack('<I4s', len(body), b'JSON') + body + struct.pack('<I4s', len(binary), b'BIN\0') + binary
    return struct.pack('<4sII', b'glTF', 2, 12 + len(chunks)) + chunks


class ToolResolution(unittest.TestCase):
    def test_explicit_env_var_wins(self):
        with tempfile.TemporaryDirectory() as d:
            exe = fake_exe(d, 'custom-blender')
            with mock.patch.dict(os.environ, {'BLENDER_BIN': str(exe)}):
                self.assertEqual(runtime.find_tool('blender'), exe.resolve())

    def test_invalid_explicit_env_var_is_an_error(self):
        with mock.patch.dict(os.environ, {'FFMPEG_BIN': '/nonexistent/ffmpeg'}):
            with self.assertRaises(ValueError): runtime.find_tool('ffmpeg')

    def test_path_lookup_and_missing_tool(self):
        with tempfile.TemporaryDirectory() as d:
            exe = fake_exe(d, 'ffprobe')
            with mock.patch.dict(os.environ, {'PATH': d}, clear=True):
                self.assertEqual(runtime.find_tool('ffprobe'), exe.resolve())
                with self.assertRaises(ValueError): runtime.find_tool('ffmpeg')

    def test_bundled_assets_resolve_inside_package(self):
        for name in publish.VIEWER_ASSETS:
            self.assertTrue((runtime.ASSETS / name).is_file(), name)
        self.assertTrue(runtime.ASSETS.is_relative_to(SKILL))

    def test_clean_copy_creates_synthetic_job(self):
        with tempfile.TemporaryDirectory() as d:
            copy = Path(d) / 'blender-room-tour'
            shutil.copytree(SKILL, copy, ignore=shutil.ignore_patterns('__pycache__', 'tests'))
            job = Path(d) / 'job'
            r = subprocess.run([sys.executable, str(copy / 'scripts' / 'blender-tour'), 'example', str(job)],
                               capture_output=True, text=True, cwd=d)
            self.assertEqual(r.returncode, 0, r.stderr)
            kind, _, scene = cli.check_gates(job)
            self.assertEqual(kind, 'synthetic'); self.assertIs(scene['observations_reviewed'], False)


class ReviewGates(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.video = root / 'clip.mp4'; self.video.write_bytes(b'not really a video')
        self.job = root / 'job'; (self.job / 'references').mkdir(parents=True)
        (self.job / 'observations.md').write_text('# Visual observations\n\nStatus: awaiting visual review.\n')
        (self.job / 'recipe.py').write_text(prepare.RECIPE_TEMPLATE)
        self.meta = {'kind': 'video', 'status': 'references_ready',
                     'source': {'video': str(self.video), 'sha256': sha(self.video)},
                     'templates': {n: sha(self.job / n) for n in ('observations.md', 'recipe.py')}}
        self.write(self.meta, {'title': 'Room model', 'observations_reviewed': False})

    def tearDown(self): self.tmp.cleanup()

    def write(self, meta, scene):
        (self.job / 'metadata.json').write_text(json.dumps(meta)); (self.job / 'scene.json').write_text(json.dumps(scene))

    def review(self):
        self.write(self.meta, {'title': 'Room model', 'observations_reviewed': True})
        (self.job / 'observations.md').write_text('# Visual observations\n\nLiving room, 0-12 s ...\n')
        (self.job / 'recipe.py').write_text('def build_scene():\n    return {}\n')

    def test_unreviewed_video_job_is_refused(self):
        with self.assertRaises(ValueError): cli.check_gates(self.job)

    def test_reviewed_flag_with_untouched_templates_is_refused(self):
        self.write(self.meta, {'title': 'Room model', 'observations_reviewed': True})
        with self.assertRaisesRegex(ValueError, 'observations.md'): cli.check_gates(self.job)

    def test_reviewed_video_job_passes(self):
        self.review()
        self.assertEqual(cli.check_gates(self.job)[0], 'video')

    def test_changed_source_is_refused(self):
        self.review(); self.video.write_bytes(b'different bytes')
        with self.assertRaises(ValueError): cli.check_gates(self.job)

    def test_video_job_cannot_relabel_itself_synthetic(self):
        self.review(); self.write(dict(self.meta, kind='synthetic'), {'observations_reviewed': False})
        with self.assertRaises(ValueError): cli.check_gates(self.job)

    def test_synthetic_job_cannot_claim_review(self):
        job = cli.example(Path(self.tmp.name) / 'example')
        scene = json.loads((job / 'scene.json').read_text()); scene['observations_reviewed'] = True
        (job / 'scene.json').write_text(json.dumps(scene))
        with self.assertRaises(ValueError): cli.check_gates(job)

    def test_quality_floor_applies_to_video_only(self):
        self.assertEqual(cli.quality('synthetic', None, None), (8, [480, 270]))
        with self.assertRaises(ValueError): cli.quality('video', 4, None)
        with self.assertRaises(ValueError): cli.quality('video', None, (480, 270))


class Contract(unittest.TestCase):
    def scene(self, **changes):
        base = {'groups': {'RoomWalls': ['W'], 'RoomFloor': ['F'], 'Chair_01': ['C']},
                'views': [{'name': 'A', 'position': [0, -3, 1.6], 'target': [0, 0, 1]},
                          {'name': 'B', 'position': [2, -2, 2], 'target': [0, 0, 1]}],
                'glazing': ['Glass'], 'notes': ['Estimated.']}
        base.update(changes); return base

    def test_valid_scene(self):
        contract.validate_scene(self.scene(), {'W', 'F', 'C'}, {'Glass'})

    def test_rejections(self):
        cases = [self.scene(groups={'RoomWalls': ['W'], 'RoomFloor': ['F'], 'Chair_01': ['W']}),
                 self.scene(views=self.scene()['views'][:1]),
                 self.scene(glazing=['Missing']),
                 self.scene(notes=[])]
        for case in cases:
            with self.assertRaises(ValueError): contract.validate_scene(case, {'W', 'F', 'C'}, {'Glass'})
        with self.assertRaises(ValueError): contract.validate_scene(self.scene(), {'W', 'F', 'C', 'Extra'}, {'Glass'})


class PublicBoundary(unittest.TestCase):
    def test_sanitize_glb_strips_private_metadata(self):
        doc = {'asset': {'version': '2.0', 'generator': 'Khronos glTF Blender I/O', 'extras': {'a': 1}},
               'scene': 0, 'scenes': [{'nodes': [0], 'extras': {'reconstruction_notes': 'x'}}],
               'nodes': [{'name': 'Chair_01', 'extras': {'p': 1}}],
               'meshes': [{'name': 'IMG_1234 sofa', 'primitives': []}],
               'images': [{'name': 'IMG_1234', 'bufferView': 0, 'mimeType': 'image/png'}],
               'materials': [{'name': 'Chair_Fabric'}], 'buffers': [{'byteLength': 4}]}
        gltf, glb = publish.sanitize_glb(make_glb(doc))
        again, _ = publish.sanitize_glb(glb)
        self.assertEqual(gltf, again)
        self.assertNotIn('extras', json.dumps(gltf))
        self.assertEqual(gltf['asset']['generator'], publish.GENERATOR)
        self.assertEqual(gltf['nodes'][0]['name'], 'Chair_01')
        self.assertEqual((gltf['meshes'][0]['name'], gltf['images'][0]['name']), ('mesh_0', 'image_0'))

    def test_sanitize_glb_refuses_external_uris(self):
        doc = {'asset': {'version': '2.0'}, 'images': [{'uri': 'frames/frame_001.jpg'}], 'buffers': [{'byteLength': 4}]}
        with self.assertRaises(ValueError): publish.sanitize_glb(make_glb(doc))

    def test_glazing_must_match_transparent_materials(self):
        gltf = {'materials': [{'name': 'Window_Glass', 'alphaMode': 'BLEND'}, {'name': 'Fridge_Door'}]}
        publish.check_glazing(gltf, ['Window_Glass'])
        with self.assertRaises(ValueError): publish.check_glazing(gltf, [])
        with self.assertRaises(ValueError): publish.check_glazing(gltf, ['Window_Glass', 'Fridge_Door'])

    def test_private_strings_are_not_published(self):
        with self.assertRaises(ValueError):
            publish.assert_public_text(['Model of /home/someone/tour.mov'], ['/home/someone'])
        publish.assert_public_text(['Chair'], ['/home/someone', ''])

    def test_exported_names_and_nested_strings_are_guarded(self):
        doc = {'asset': {'version': '2.0'}, 'scenes': [{'name': 'private-tour.mov'}],
               'animations': [{'name': 'private-tour.mov'}], 'nodes': [{'name': 'Chair'}]}
        clean, _ = publish.sanitize_glb(make_glb(doc))
        self.assertEqual(clean['scenes'][0]['name'], 'scene_0')
        self.assertEqual(clean['animations'][0]['name'], 'animation_0')
        self.assertEqual(clean['nodes'][0]['name'], 'Chair')
        clean['extensions'] = {'custom': {'caption': 'PRIVATE-TOUR.MOV'}}
        with self.assertRaises(ValueError):
            publish.assert_public_text(publish.public_strings({}, clean), ['private-tour.mov'])

    def test_embedded_texture_inventory_and_invalid_reference(self):
        doc = {'images': [{'bufferView': 0, 'mimeType': 'image/png', 'name': 'source.png'}],
               'bufferViews': [{'byteLength': 123}]}
        self.assertEqual(publish.embedded_images(doc), {'count': 1, 'bytes': 123,
                         'images': [{'name': 'image_0', 'mime_type': 'image/png', 'bytes': 123}]})
        self.assertEqual(publish.embedded_images({})['count'], 0)
        doc['images'][0]['bufferView'] = 3
        with self.assertRaises(ValueError): publish.embedded_images(doc)

    def test_public_dir_is_exact_allowlist(self):
        with tempfile.TemporaryDirectory() as d:
            public = Path(d) / 'public'; public.mkdir()
            for name in publish.PUBLIC_FILES: (public / name).write_text(name)
            publish.check_public(public)
            (public / 'room.blend').write_text('private')
            with self.assertRaises(ValueError): publish.check_public(public)
            (public / 'room.blend').unlink(); (public / 'viewer.json').unlink()
            (Path(d) / 'secret.json').write_text('{}'); (public / 'viewer.json').symlink_to(Path(d) / 'secret.json')
            with self.assertRaises(ValueError): publish.check_public(public)
            self.assertIsNone(server.resolve_request(public.resolve(), '/viewer.json'))


class Server(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        public = root / 'build' / 'public'; public.mkdir(parents=True)
        for name in publish.PUBLIC_FILES: (public / name).write_text('public ' + name)
        (root / 'build' / 'room.blend').write_text('private'); (root / 'secret.txt').write_text('private')
        self.httpd = server.make_server(public)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.tmp.cleanup()

    def get(self, path, host=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        if host:
            conn.putrequest('GET', path, skip_host=True); conn.putheader('Host', host); conn.endheaders()
        else:
            conn.request('GET', path)
        r = conn.getresponse(); body = r.read(); conn.close(); return r.status, body

    def test_binds_localhost_only(self):
        self.assertEqual(self.httpd.server_address[0], '127.0.0.1')

    def test_allowlisted_files_served(self):
        self.assertEqual(self.get('/'), (200, b'public index.html'))
        self.assertEqual(self.get('/viewer.json?x=1')[0], 200)

    def test_private_and_traversal_paths_refused(self):
        for path in ('/room.blend', '/../room.blend', '/%2e%2e/secret.txt', '/..%2f..%2fsecret.txt',
                     '//etc/passwd', '/references/frame_001.jpg', '/viewer.json/'):
            self.assertEqual(self.get(path)[0], 404, path)

    def test_foreign_host_header_refused(self):
        self.assertEqual(self.get('/', host='attacker.example')[0], 403)


class Receipt(unittest.TestCase):
    def test_modified_artifact_detected(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'room.glb').write_bytes(b'a'); cli.write_receipt(d)
            self.assertTrue(cli.verify_files(d))
            (Path(d) / 'room.glb').write_bytes(b'b')
            with self.assertRaises(ValueError): cli.verify_files(d)


if __name__ == '__main__':
    unittest.main()
