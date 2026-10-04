"""SYNTHETIC example recipe. Invented geometry; not derived from any video or property.

Demonstrates the build_scene() contract: independent floor, walls, and
furniture objects, one group per item, a declared glazing material, and two
review views. Do not reuse this layout for a real room.
"""
import bmesh
import bpy


def material(name, color, alpha=1.0, roughness=0.6):
    m = bpy.data.materials.new(name)
    if not m.use_nodes:
        m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    if alpha < 1:
        # Intended glazing: alpha below 1 exports as glTF alphaMode BLEND.
        bsdf.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED'
        if hasattr(m, 'blend_method'):
            m.blend_method = 'BLEND'
    return m


def box(name, size, location, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    return name


def legs(prefix, cx, cy, half_x, half_y, height, mat):
    return [box(f'{prefix}_Leg_{i}', (.04, .04, height), (cx + sx * half_x, cy + sy * half_y, height / 2), mat)
            for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1)), 1)]


def build_scene():
    floor_mat = material('Floor_Wood', (.45, .32, .22), roughness=.5)
    wall_mat = material('Wall_Paint', (.82, .80, .76), roughness=.8)
    chair_mat = material('Chair_Fabric', (.20, .33, .45))
    metal = material('Table_Metal', (.12, .12, .12), roughness=.35)
    glass = material('Table_Glass', (.75, .85, .85), alpha=.3, roughness=.05)

    floor = box('Floor', (4.0, 3.5, .05), (0, 0, -.025), floor_mat)
    walls = [box('Wall_Back', (4.0, .1, 2.5), (0, 1.8, 1.25), wall_mat),
             box('Wall_Left', (.1, 3.5, 2.5), (-2.05, 0, 1.25), wall_mat)]
    chair = [box('Chair_Seat', (.5, .5, .06), (-1.1, .9, .45), chair_mat),
             box('Chair_Back', (.5, .06, .5), (-1.1, 1.12, .73), chair_mat)]
    chair += legs('Chair', -1.1, .9, .21, .21, .42, metal)
    table = [box('Table_Top', (.8, .5, .02), (.4, .8, .5), glass)]
    table += legs('Table', .4, .8, .36, .21, .49, metal)

    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (.8, .2, .6)
    bpy.context.scene.collection.objects.link(sun)
    world = bpy.context.scene.world or bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.color = (.6, .65, .7)
    if not world.use_nodes:
        world.use_nodes = True
    background = world.node_tree.nodes.get('Background')
    if background:
        background.inputs['Color'].default_value = (.6, .65, .7, 1)
        background.inputs['Strength'].default_value = .6

    return {
        'groups': {'RoomFloor': [floor], 'RoomWalls': walls, 'Chair_01': chair, 'Table_01': table},
        'labels': {'Chair_01': 'Chair', 'Table_01': 'Glass-top table'},
        'glazing': ['Table_Glass'],
        'views': [
            {'name': 'Front', 'label': 'Front', 'position': [.3, -3.0, 1.6], 'target': [-.3, .8, .5]},
            {'name': 'Corner', 'label': 'Side corner', 'position': [2.4, -1.2, 2.0], 'target': [-.6, .9, .4]},
        ],
        'notes': ['Synthetic example room with invented dimensions; not derived from any video or property.'],
    }
