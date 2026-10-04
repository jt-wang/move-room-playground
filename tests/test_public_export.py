"""Standard-library checks for the synthetic demo generator and the public build boundary.

Run: python3 -m unittest discover -s tests -p 'test_*.py'
"""
import hashlib, importlib.util, json, math, os, shutil, struct, sys, tempfile, unittest, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


generator = load('generate_demo', ROOT / 'scripts' / 'generate-demo.py')
build_public = load('build_public', ROOT / 'build_public.py')
OUTPUTS = generator.outputs()


def read_glb(data):
    magic, version, length = struct.unpack_from('<4sII', data)
    assert (magic, version, length) == (b'glTF', 2, len(data))
    json_len, json_type = struct.unpack_from('<I4s', data, 12); assert json_type == b'JSON'
    gltf = json.loads(data[20:20 + json_len])
    bin_offset = 20 + json_len
    bin_len, bin_type = struct.unpack_from('<I4s', data, bin_offset); assert bin_type == b'BIN\0'
    return gltf, data[bin_offset + 8: bin_offset + 8 + bin_len]


def read_png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, chunks = 8, {}
    while pos < len(data):
        length, kind = struct.unpack_from('>I4s', data, pos)
        body = data[pos + 8: pos + 8 + length]
        crc, = struct.unpack_from('>I', data, pos + 8 + length)
        assert crc == zlib.crc32(kind + body) & 0xffffffff, kind
        chunks.setdefault(kind, b''); chunks[kind] += body; pos += 12 + length
    width, height, depth, colour, _, _, _ = struct.unpack('>IIBBBBB', chunks[b'IHDR'])
    raw = zlib.decompress(chunks[b'IDAT'])
    assert (depth, colour) == (8, 2) and len(raw) == height * (1 + 3 * width)
    return width, height, raw


class Generator(unittest.TestCase):
    def test_deterministic_and_matches_checked_in_assets(self):
        again = generator.outputs()
        for name, data in OUTPUTS.items():
            self.assertEqual(hashlib.sha256(data).digest(), hashlib.sha256(again[name]).digest(), name)
            committed = ROOT / 'assets' / name
            self.assertTrue(committed.is_file(), f'{name} missing: run npm run generate:demo')
            self.assertEqual(committed.read_bytes(), data, f'{name} differs from generator output: run npm run generate:demo')

    def test_glb_buffers_indices_and_normals_are_valid(self):
        gltf, blob = read_glb(OUTPUTS['room.glb'])
        self.assertTrue(gltf['asset']['extras']['synthetic'])
        self.assertEqual(gltf['buffers'][0]['byteLength'], len(blob))
        formats = {(5126, 'VEC3'): '<3f', (5123, 'SCALAR'): '<H'}
        def values(i):
            acc = gltf['accessors'][i]; view = gltf['bufferViews'][acc['bufferView']]; fmt = formats[(acc['componentType'], acc['type'])]
            self.assertLessEqual(view['byteOffset'] + view['byteLength'], len(blob)); self.assertEqual(view['byteOffset'] % 4, 0)
            self.assertEqual(struct.calcsize(fmt) * acc['count'], view['byteLength'])
            return [struct.unpack_from(fmt, blob, view['byteOffset'] + k * struct.calcsize(fmt)) for k in range(acc['count'])]
        for mesh in gltf['meshes']:
            for prim in mesh['primitives']:
                pos_acc = gltf['accessors'][prim['attributes']['POSITION']]
                positions, normals = values(prim['attributes']['POSITION']), values(prim['attributes']['NORMAL'])
                indices = [i for (i,) in values(prim['indices'])]
                self.assertEqual(len(indices) % 3, 0); self.assertLess(max(indices), len(positions))
                self.assertEqual(pos_acc['min'], [min(p[k] for p in positions) for k in range(3)])
                self.assertEqual(pos_acc['max'], [max(p[k] for p in positions) for k in range(3)])
                for n in normals: self.assertAlmostEqual(math.sqrt(sum(c * c for c in n)), 1.0, places=6)
                # Every triangle winds outward: its face normal agrees with the vertex normal.
                for t in range(0, len(indices), 3):
                    a, b, c = (positions[i] for i in indices[t:t + 3])
                    e1 = [b[k] - a[k] for k in range(3)]; e2 = [c[k] - a[k] for k in range(3)]
                    cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
                    self.assertGreater(sum(cross[k] * normals[indices[t]][k] for k in range(3)), 0, mesh['name'])

    def test_metadata_is_synthetic_single_level_without_doors(self):
        meta = json.loads(OUTPUTS['room.json'])
        self.assertTrue(meta['synthetic']); self.assertEqual(meta['doors'], []); self.assertNotIn('levels', meta)
        gltf, _ = read_glb(OUTPUTS['room.glb'])
        top = {gltf['nodes'][i]['name'] for i in gltf['scenes'][0]['nodes']}
        self.assertEqual({g['name'] for g in meta['groups']}, top)

    def test_pngs_are_valid_with_expected_sizes(self):
        for name, size in {'clay-normal.png': (256, 256), 'preview.png': (640, 360), 'og.png': (1200, 630)}.items():
            width, height, raw = read_png(OUTPUTS[name])
            self.assertEqual((width, height), size, name)
            self.assertTrue(all(raw[y * (1 + 3 * width)] == 0 for y in range(height)))
        # The clay map encodes unit normals pointing out of the surface (blue dominant).
        width, _, raw = read_png(OUTPUTS['clay-normal.png'])
        self.assertGreater(min(raw[1 + 3 * x + 2] for x in range(width)), 200)


class PublicBuild(unittest.TestCase):
    def make_project(self, d):
        project = Path(d) / 'project'; project.mkdir()
        shutil.copy2(ROOT / 'build_public.py', project)
        for name in build_public.ALLOWLIST:
            target = project / name; target.parent.mkdir(parents=True, exist_ok=True)
            if name.startswith('assets/') and Path(name).name in OUTPUTS: target.write_bytes(OUTPUTS[Path(name).name])
            else: shutil.copy2(ROOT / name, target)
        (project / 'serve.mjs').write_text('// server code must never be published\n')
        (project / 'notes.md').write_text('private notes\n')
        return project

    def test_exact_allowlist_and_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            project = self.make_project(d)
            receipt = build_public.build(project)
            out = project / 'public'
            found = sorted(str(p.relative_to(out)).replace(os.sep, '/') for p in out.rglob('*') if p.is_file())
            self.assertEqual(found, sorted([*build_public.ALLOWLIST, build_public.MARKER]))
            self.assertEqual(set(receipt['files']), set(build_public.ALLOWLIST))
            for name, digest in receipt['files'].items():
                self.assertEqual(hashlib.sha256((out / name).read_bytes()).hexdigest(), digest)
            self.assertEqual(json.loads((project / 'public-receipt.json').read_text()), receipt)
            build_public.build(project)  # rebuilding over its own output is allowed
            self.assertFalse([p for p in project.iterdir() if p.name.startswith('.public-staging-')])

    def test_refuses_symlinks_foreign_output_and_unlisted_imports(self):
        with tempfile.TemporaryDirectory() as d:
            project = self.make_project(d)
            (project / 'public').mkdir(); (project / 'public' / 'keep.txt').write_text('not ours')
            with self.assertRaisesRegex(build_public.BuildError, 'not created by this build'): build_public.build(project)
            shutil.rmtree(project / 'public')
            (project / 'public').symlink_to(Path(d))
            with self.assertRaisesRegex(build_public.BuildError, 'symlink'): build_public.build(project)
            (project / 'public').unlink()
            (project / 'style.css').unlink(); (project / 'style.css').symlink_to(ROOT / 'style.css')
            with self.assertRaisesRegex(build_public.BuildError, 'symlink'): build_public.build(project)
            (project / 'style.css').unlink(); shutil.copy2(ROOT / 'style.css', project)
            with (project / 'rooms.mjs').open('a') as f: f.write("\nimport './secret.mjs';\n")
            with self.assertRaisesRegex(build_public.BuildError, 'non-allowlisted'): build_public.build(project)

    def test_server_code_and_task_notes_are_not_allowlisted(self):
        for name in ('serve.mjs', 'worker.mjs', 'metrics.mjs', 'build_public.py', 'package.json', 'INTERNAL_NOTES.md', 'private-catalog.mjs'):
            self.assertNotIn(name, build_public.ALLOWLIST)
        self.assertFalse(any(n.startswith(('skills/', 'tests/', 'scripts/', 'docs/')) for n in build_public.ALLOWLIST))


if __name__ == '__main__':
    unittest.main()
