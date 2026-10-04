"""SYNTHETIC articulated example. Invented geometry; not derived from any video, image or property.

Exercises the geometry helpers and the door contract: a plank floor, a window
with sashes and fall bars, an open-shell kitchenette with a hollow inset sink,
round burners and separate cabinet fronts, open shelves, a hinged door, a
sliding door, and a two-panel bifold closet with independently owned panels.
Pair it with articulated_room.interaction.json. Do not reuse this layout.
"""
import bpy

from blender_tour_flow import geometry as g

W, D, H = 4.2, 3.4, 2.5   # invented interior width (X), depth (Y), ceiling height
DOOR_H = 2.0


def build_scene():
    m = {
        'wall': g.material('Wall_Paint', (226, 223, 214), roughness=.85),
        'plank': g.material('Floor_Plank', (205, 188, 160), roughness=.5),
        'seam': g.material('Floor_Seam', (92, 80, 66), roughness=.7),
        'ceiling': g.material('Ceiling_Paint', (238, 236, 230), roughness=.9),
        'trim': g.material('Trim_White', (240, 238, 232), roughness=.5),
        'leaf': g.material('Door_Leaf', (214, 206, 190), roughness=.55),
        'metal': g.material('Handle_Metal', (150, 150, 148), roughness=.3, metallic=.9),
        'frame': g.material('Window_Frame', (40, 40, 42), roughness=.4, metallic=.3),
        'glass': g.material('Window_Glass', (210, 222, 230), alpha=.45, roughness=.1),
        'counter': g.material('Worktop', (232, 230, 224), roughness=.35),
        'steel': g.material('Basin_Steel', (170, 170, 168), roughness=.3, metallic=.9),
        'dark': g.material('Drain_Dark', (35, 35, 36), roughness=.5),
        'cabinet': g.material('Cabinet_Front', (190, 176, 150), roughness=.6),
        'plinth': g.material('Plinth_Dark', (60, 50, 44), roughness=.6),
        'hob': g.material('Hob_Plate', (225, 225, 222), roughness=.4),
        'burner': g.material('Burner_Metal', (90, 90, 92), roughness=.4, metallic=.6),
        'black': g.material('Grate_Black', (25, 25, 26), roughness=.5),
    }
    groups, labels = {}, {}

    def add(group, names, label):
        groups.setdefault(group, []).extend(names)
        labels[group] = label

    add('RoomFloor', g.plank_floor('Floor', (0, 0), (W, D), {'plank': m['plank'], 'seam': m['seam']}, direction='y')
        + [g.box('Closet_Floor', (W + .1, 1.4, -.012), (W + .7, 2.3, 0), m['plank'])], 'Floor (invented)')
    add('RoomCeiling', [g.box('Ceiling', (-.1, -.1, H), (W + .8, D + .1, H + .05), m['ceiling'])], 'Ceiling')
    walls = g.wall('Wall_South', 'x', -.1, W + .1, -.1, 0, H, m['wall'], [(.5, 1.3, 0, DOOR_H)])
    walls += g.wall('Wall_West', 'y', 0, D, -.1, 0, H, m['wall'], [(2.2, 3.0, 0, DOOR_H)])
    walls += g.wall('Wall_North', 'x', -.1, W + .1, D, D + .1, H, m['wall'], [(1.4, 2.6, .9, 2.1)])
    walls += g.wall('Wall_East', 'y', 0, D, W, W + .1, H, m['wall'], [(1.4, 2.3, 0, DOOR_H)])
    walls += [g.boxes('Closet_Shell', [((W + .1, 1.3, 0), (W + .8, 1.4, H)), ((W + .1, 2.3, 0), (W + .8, 2.4, H)),
                                       ((W + .7, 1.4, 0), (W + .8, 2.3, H))], m['wall'])]
    add('RoomWalls', walls, 'Walls (invented)')

    # Hinged entry door: root on the hinge line; +90 swings the leaf from +X toward +Y, into the room.
    add('EntryFrame', g.door_frame('Entry', 'x', .5, 1.3, -.1, 0, DOOR_H + .02, m['trim']), 'Entry door frame')
    group, names = g.hinged_leaf('EntryDoor', (.52, -.05), .76, DOOR_H, {'leaf': m['leaf'], 'handle': m['metal']}, '+x')
    add(group, names, 'Entry door')
    # Surface-mounted sliding door on the room side of the west wall; slides toward -Y.
    add('PantryFrame', g.door_frame('Pantry', 'y', 2.2, 3.0, -.1, 0, DOOR_H + .02, m['trim'], threshold=False), 'Pantry opening')
    add('PantryTrack', [g.box('PantryTrack_Rail', (0, 1.3, DOOR_H + .04), (.06, 3.1, DOOR_H + .09), m['trim'])], 'Sliding track')
    group, names = g.sliding_leaf('PantrySlider', (.01, 2.17, .01), (.045, 3.03, DOOR_H + .02),
                                  {'leaf': m['leaf'], 'pull': m['metal']}, pull_side=1)
    add(group, names, 'Sliding door')
    # Bifold closet: panel A on the jamb, panel B on A's free edge; the jamb/head stay static.
    add('ClosetTrack', g.door_frame('ClosetTrack', 'y', 1.4, 2.3, W, W + .1, DOOR_H, m['trim']), 'Closet track')
    panels, _ = g.bifold_pair('ClosetFold', (W + .05, 1.4), .45, DOOR_H - .01, {'panel': m['leaf'], 'pull': m['metal']}, '+y')
    for group, names in panels.items():
        add(group, names, 'Closet bifold panel')

    # Window: framed sashes on two tracks, glass, exterior fall bars and sill.
    frame, glass = g.sliding_window('NorthWindow', 'x', 1.4, 2.6, .9, 2.1, D, D + .1,
                                    {'frame': m['frame'], 'glass': m['glass'], 'sill': m['trim']}, fall_bars=(1.05, 1.2))
    add('NorthWindow', frame + glass, 'Window')

    # Kitchenette: an open carcass shell (a solid block would fill the basin), separate fronts,
    # a worktop with a real cut-out and hollow basin, and two round burners.
    add('Kitchenette_Cabinet', [g.boxes('Kitchenette_Carcass', [((2.8, 2.8, .1), (2.82, D, .85)), ((4.08, 2.8, .1), (4.1, D, .85)),
                                                                ((2.82, D - .02, .1), (4.08, D, .85)), ((2.82, 2.8, .1), (4.08, D - .02, .12))],
                                        m['cabinet']),
                                g.box('Kitchenette_Plinth', (2.82, 2.84, 0), (4.08, D, .1), m['plinth'])]
        + g.cabinet_fronts('Kitchenette', (2.8, 2.8, .1), (4.1, D, .85), '-y', 3, {'front': m['cabinet'], 'handle': m['metal']}),
        'Kitchenette cabinet')
    add('Kitchenette_Sink', g.inset_basin('Sink', (2.78, 2.76, .85), (4.12, D, .88), (2.95, 2.9), (3.45, 3.3), .18,
                                          {'counter': m['counter'], 'basin': m['steel'], 'drain': m['dark']}),
        'Worktop and sink')
    hob = [g.box('Hob_Plate', (3.6, 2.85, .88), (4.05, 3.3, .885), m['hob'])]
    for i, x in enumerate((3.71, 3.94), 1):
        hob += g.gas_burner(f'Burner{i}', (x, 3.07, .885), {'tray': m['hob'], 'burner': m['burner'], 'cap': m['black'],
                                                             'grate': m['black']}, radius=.045)
    add('Kitchenette_Hob', hob, 'Two-burner hob')
    add('WallShelf', g.open_shelves('WallShelf', (2.85, 3.15, 1.45), (3.5, D, 2.05), (1.65, 1.85), m['trim'], front='-y'),
        'Open shelves')

    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (.8, .2, .6)
    bpy.context.scene.collection.objects.link(sun)
    world = bpy.context.scene.world or bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    if not world.use_nodes:
        world.use_nodes = True
    background = world.node_tree.nodes.get('Background')
    if background:
        background.inputs['Color'].default_value = (.6, .65, .7, 1)
        background.inputs['Strength'].default_value = .6

    return {
        'groups': groups,
        'labels': labels,
        'glazing': ['Window_Glass'],
        'views': [
            {'name': 'Overview', 'label': 'Roofless overview', 'position': [2.1, -4.0, 7.5], 'target': [2.1, 1.7, 0],
             'lens': 24, 'cutaway': True, 'doors_open': True, 'spaces': ['main', 'kitchenette', 'closet']},
            {'name': 'FromEntry', 'label': 'From the entry', 'position': [.9, .4, 1.55], 'target': [3.6, 3.0, .9],
             'lens': 18, 'spaces': ['main', 'kitchenette'], 'adjacent': ['TowardCloset']},
            {'name': 'TowardCloset', 'label': 'Toward the closet', 'position': [1.0, 2.8, 1.5], 'target': [4.2, 1.6, 1.0],
             'lens': 18, 'orientation': 'portrait', 'doors_open': True, 'spaces': ['main', 'closet']},
        ],
        'notes': ['Synthetic articulated example with invented dimensions; not derived from any video, image or property.',
                  'Doors are modelled closed; interaction.json declares their motion in Blender coordinates.'],
    }
