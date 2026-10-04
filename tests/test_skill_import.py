import copy, importlib.util, json, math, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('skill_import',ROOT/'scripts/import-skill.py')
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
FIXTURE=json.loads((ROOT/'skills/blender-room-tour/tests/fixtures/articulated-doors.json').read_text())

# Schema 1 (web-space angles the app negates) is legacy: these checks run with the explicit legacy flag.
class SkillImport(unittest.TestCase):
    def setUp(self):
        self.viewer={'title':'Fictional test','synthetic':True,'groups':[{'name':'Floor','kind':'floor'},{'name':'Door','kind':'object'}]}
        self.gltf={'nodes':[{'name':'Floor','mesh':0},{'name':'Door','mesh':1}]}
        self.room={'id':'test-room','bounds':{'min':[-3,0,-2],'max':[3,2.5,2]},'doors':[{'id':'entry','kind':'door','ordinal':1,'parts':[{'name':'Door','angle':90}]}]}
    def check(self):return adapter.validate(self.viewer,self.gltf,self.room,legacy=True)
    def test_hinged_and_sliding_contract(self):
        self.assertEqual(self.check()['id'],'test-room')
        self.room['doors'][0]['parts'][0]={'name':'Door','slide':[1,0,0]}
        self.assertTrue(self.check()['imported'])
    def test_legacy_schema_needs_explicit_flag(self):
        with self.assertRaisesRegex(ValueError,'schema_version'):adapter.validate(self.viewer,self.gltf,self.room)
        self.assertEqual(adapter.runtime_doors(self.room),self.room['doors'])  # legacy metadata is copied unchanged
    def test_bad_bounds(self):
        for bad in ([0,0,0],[3,float('nan'),2],[3,float('inf'),2],[3,True,2]):
            with self.subTest(bad=bad):
                self.room['bounds']['max']=bad
                with self.assertRaises(ValueError):self.check()
    def test_reserved_id_and_levels(self):
        self.room['id']='practice-room'
        with self.assertRaises(ValueError):self.check()
        self.room['id']='test-room';self.room['levels']=[]
        with self.assertRaises(ValueError):self.check()
    def test_duplicate_and_missing_nodes(self):
        self.gltf['nodes'][1]['name']='missing'
        with self.assertRaises(ValueError):self.check()
        self.gltf['nodes'][1]['name']='Floor'
        with self.assertRaises(ValueError):self.check()
    def test_nested_groups_cannot_duplicate_door_collision(self):
        self.gltf['nodes'][0]['children']=[1]
        with self.assertRaisesRegex(ValueError,'Overlapping'):self.check()
    def test_part_must_be_independent_group(self):
        self.gltf['nodes'].append({'name':'child','mesh':2})
        self.room['doors'][0]['parts'][0]['name']='child'
        with self.assertRaises(ValueError):self.check()
    def test_invalid_motion_and_duplicate_doors(self):
        part=self.room['doors'][0]['parts'][0]
        for angle in (float('nan'),float('inf'),True,0,200):
            part['angle']=angle
            with self.assertRaises(ValueError):self.check()
        part['angle']=90;self.room['doors']*=2
        with self.assertRaises(ValueError):self.check()
    def test_extension_uri_is_refused(self):
        self.gltf['extensions']={'something':{'uri':'https://example.invalid/private'}}
        with self.assertRaisesRegex(ValueError,'URI'):self.check()
    def test_existing_output_not_modified(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'keep').write_text('intact')
            with self.assertRaisesRegex(ValueError,'new directory'):adapter.run(p/'missing',p/'missing.json',p)
            self.assertEqual((p/'keep').read_text(),'intact')


def web(v):return [v[0],v[2],-v[1]]


def fixture_gltf():
    """GLB JSON shaped like the skill's export: one top-level root per group, meshes as children."""
    nodes,meshes,accessors,top=[],[],[],[]
    def group(name,pivot,box):
        lo,hi=web(box['min']),web(box['max']);lo,hi=[min(a,b) for a,b in zip(lo,hi)],[max(a,b) for a,b in zip(lo,hi)]
        p=web(pivot)
        accessors.append({'min':[a-b for a,b in zip(lo,p)],'max':[a-b for a,b in zip(hi,p)]})
        meshes.append({'primitives':[{'attributes':{'POSITION':len(accessors)-1}}]})
        nodes.append({'name':name+'_Mesh','mesh':len(meshes)-1})
        nodes.append({'name':name,'translation':p,'children':[len(nodes)-1]});top.append(len(nodes)-1)
    group('Floor',[2.5,1.75,0],{'min':[0,-.5,-.05],'max':[5,4,0]})
    for name,pivot in FIXTURE['pivots'].items():group(name,pivot,FIXTURE['bounds'][name])
    for name,box in FIXTURE['static'].items():group(name,box['min'],box)
    return {'nodes':nodes,'meshes':meshes,'accessors':accessors,'scenes':[{'nodes':top}]}


class BlenderSpaceImport(unittest.TestCase):
    def setUp(self):
        self.spec=copy.deepcopy(FIXTURE['interaction']);self.gltf=fixture_gltf()
        names=[*FIXTURE['pivots'],*FIXTURE['static']]
        self.viewer={'title':'Fixture','synthetic':True,'groups':[{'name':'Floor','kind':'floor'}]+[{'name':n,'kind':'object'} for n in names]}
    def check(self):return adapter.validate(self.viewer,self.gltf,self.spec)
    def node(self,name):return next(n for n in self.gltf['nodes'] if n['name']==name)
    def test_schema_2_converts_to_explicit_web_yaw(self):
        config=self.check()
        self.assertEqual(config['bounds'],FIXTURE['runtime']['bounds'])
        self.assertEqual(adapter.runtime_doors(self.spec),FIXTURE['runtime']['doors'])
        self.assertTrue(all('angle' not in p for d in adapter.runtime_doors(self.spec) for p in d['parts']))
    def test_pivots_read_from_glb_match_the_fixture(self):
        geometry=adapter.group_geometry(self.gltf,['HingedDoor','ClosetPanelB'])
        self.assertEqual(adapter.blender(geometry['ClosetPanelB']['pivot']),[2.45,3.0,0.0])
        for got,want in zip(adapter.blender(geometry['HingedDoor']['max']),[1.8,-.02,2.0]):
            self.assertTrue(math.isclose(got,want,abs_tol=1e-9) or math.isclose(got,.02,abs_tol=1e-9),got)
    def test_hinge_not_on_panel_is_refused(self):
        # Move only the root; the leaf mesh keeps its world position.
        old,new=web(FIXTURE['pivots']['HingedDoor']),web([.4,0,0])
        self.node('HingedDoor')['translation']=new;self.node('HingedDoor_Mesh')['translation']=[a-b for a,b in zip(old,new)]
        with self.assertRaisesRegex(ValueError,'Hinge pivot'):self.check()
    def test_bifold_child_away_from_parent_is_refused(self):
        self.node('ClosetPanelB')['translation']=web([3.2,3.0,0])  # panel and hinge together, detached from panel A
        with self.assertRaisesRegex(ValueError,'separate'):self.check()
    def test_invalid_part_transforms_are_refused(self):
        cases=[('scale',[1,2,1],'unscaled'),('rotation',[0,.5,0,.5],'unit quaternion'),('translation',[float('nan'),0,0],'transform'),
               ('matrix',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],'matrix')]
        for key,value,message in cases:
            with self.subTest(key=key):
                self.gltf=fixture_gltf();self.node('SlidingDoor')[key]=value
                with self.assertRaisesRegex(ValueError,message):self.check()
    def test_static_or_room_groups_cannot_move(self):
        self.viewer['groups'][1]['kind']='walls'
        with self.assertRaisesRegex(ValueError,'separate object group'):self.check()
    def test_cycles_and_missing_parents_are_refused(self):
        closet=next(d for d in self.spec['doors'] if d['id']=='closet')
        closet['parts'][0]['parent']='ClosetPanelB'
        with self.assertRaisesRegex(ValueError,'cycle'):self.check()
        closet['parts'][0].pop('parent');closet['parts'][1]['parent']='HingedDoor'
        with self.assertRaisesRegex(ValueError,'missing parent'):self.check()
