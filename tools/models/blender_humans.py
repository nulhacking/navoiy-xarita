"""Build the reference cast from CC0 MakeHuman topology using Blender 5.2.

Run with Blender --background --python tools/models/blender_humans.py.
Vendor assets live in artifacts/blender-work; nothing is installed globally.
"""
import bpy, sys, os, json, math, bmesh
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'artifacts/blender-work'
ASSETS = WORK / 'assets'
OUT = ROOT / 'apps/client/public/models/reference'
sys.path.insert(0, str(WORK / 'vendor/mpfb2-master/src'))
# MPFB's extension path API normally requires an installed extension. Keep its
# cache in this build directory when running the source checkout headlessly.
original_extension_path = bpy.utils.extension_path_user
bpy.utils.extension_path_user = lambda package, **kwargs: str(WORK / 'mpfb-cache') if package == 'mpfb' else original_extension_path(package, **kwargs)
(WORK / 'mpfb-cache').mkdir(exist_ok=True)
import mpfb
bpy.context.preferences.addons.new().module = 'mpfb'
mpfb.register()
from mpfb.services.humanservice import HumanService
from mpfb.services.targetservice import TargetService
from mpfb.services.exportservice import ExportService

def asset(kind, name, ext='mhclo'):
    paths = list((ASSETS / kind).rglob(name + '.' + ext))
    if not paths: raise FileNotFoundError((kind, name, ext))
    return str(paths[0])

def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def plain_material(name, color, roughness=.8, normal_from=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    if normal_from:
        for node in normal_from.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image and 'normal' in node.image.name.lower():
                tex = mat.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = node.image
                normal = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                mat.node_tree.links.new(tex.outputs['Color'], normal.inputs['Color'])
                mat.node_tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    return mat

def upper_vertices(obj, threshold=1.02):
    adjacent=[set() for _ in obj.data.vertices]
    for edge in obj.data.edges:
        a,b=edge.vertices;adjacent[a].add(b);adjacent[b].add(a)
    unseen=set(range(len(adjacent)));upper=set()
    while unseen:
        seed=unseen.pop();component={seed};todo=[seed]
        while todo:
            for j in adjacent[todo.pop()]:
                if j in unseen:unseen.remove(j);component.add(j);todo.append(j)
        average=sum(obj.data.vertices[i].co.z for i in component)/len(component)
        if average>threshold:upper.update(component)
    return upper

def remove_region(obj, indices):
    bm=bmesh.new();bm.from_mesh(obj.data);bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=[bm.verts[i] for i in indices],context='VERTS')
    bm.to_mesh(obj.data);bm.free()

def neutral_rest(rig, meshes):
    # Lower both arms from the MakeHuman A-pose before baking a new bind pose.
    for side, sign in [('l',1),('r',-1)]:
        for stem, direction in [('upperarm',(sign*.16,0,-1)),('lowerarm',(sign*.05,-.04,-1))]:
            pb = rig.pose.bones[stem+'_'+side]
            bpy.context.view_layer.update()
            delta = (pb.tail-pb.head).normalized().rotation_difference(Vector(direction).normalized())
            pb.matrix = Matrix.Translation(pb.head) @ delta.to_matrix().to_4x4() @ Matrix.Translation(-pb.head) @ pb.matrix
            bpy.context.view_layer.update()
    for obj in meshes:
        active(obj)
        for modifier in list(obj.modifiers):
            if modifier.type == 'ARMATURE': bpy.ops.object.modifier_apply(modifier=modifier.name)
    active(rig)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in meshes:
        mod=obj.modifiers.new('Deform','ARMATURE'); mod.object=rig

def render_preview(identifier):
    scene=bpy.context.scene
    scene.render.engine='CYCLES'; scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=900;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
    scene.world.color=(.35,.35,.35)
    world=scene.world;world.use_nodes=True
    world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.5,.53,.58,1)
    world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.35
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor=bpy.context.object;floor.name='StudioFloor';floor.location.z=-.004
    floor.data.materials.append(plain_material('Studio floor',(.33,.34,.35),.9))
    for loc,power,size in [((3,-4,5),500,4),((-3,-1,3),260,3),((1,3,4),450,3)]:
        bpy.ops.object.light_add(type='AREA',location=loc)
        light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size
        light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(2,-4.8,1.85))
    cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.92))-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=2.05;scene.camera=cam
    scene.render.filepath=str(WORK/(identifier+'-blender.png'))
    bpy.ops.render.render(write_still=True)

def create_character(identifier='yigit'):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    female = identifier == 'qiz'
    macro = TargetService.get_default_macro_info_dict()
    macro.update(gender=0 if female else 1, age=.51 if identifier in ['qiz','yigit'] else .68 if identifier=='ishbilarmon' else .63,
                 muscle=.42 if female else .67 if identifier=='ishchi' else .58, weight=.43 if female else .56 if identifier=='ishbilarmon' else .49, proportions=.65,
                 race={'asian':.32, 'caucasian':.68, 'african':0})
    body = HumanService.create_human(macro_detail_dict=macro)
    skin='young_caucasian_female' if female else 'middleage_caucasian_male' if identifier in ['ishbilarmon','ishchi'] else 'young_caucasian_male2'
    HumanService.set_character_skin(asset('skins', skin, 'mhmat'), body, skin_type='GAMEENGINE')
    rig = HumanService.add_builtin_rig(body, 'game_engine')
    outfit = {'yigit':'male_casualsuit06','qiz':'male_casualsuit01','ishbilarmon':'male_elegantsuit01','ishchi':'male_casualsuit01'}[identifier]
    for kind, name, typ in [
        ('eyes','high-poly','Eyes'), ('eyebrows','eyebrow001','Eyebrows'),
        ('hair','ponytail01' if female else 'short02' if identifier=='ishbilarmon' else 'short01','Hair'),
        ('clothes',outfit,'Clothes'),
        ('clothes','shoes03' if identifier=='ishbilarmon' else 'shoes02' if identifier=='ishchi' else 'shoes05','Clothes')]:
        HumanService.add_mhclo_asset(asset(kind,name), body, asset_type=typ, subdiv_levels=0, material_type='GAMEENGINE')
    clothes = next(o for o in bpy.context.scene.objects if outfit in o.name)
    top=upper_vertices(clothes,.88 if female else 1.02)
    if female:
        jeans=HumanService.add_mhclo_asset(asset('clothes','female_casualsuit01'),body,asset_type='Clothes',subdiv_levels=0,material_type='GAMEENGINE')
        remove_region(jeans,upper_vertices(jeans,.88))
        # This collared outfit is one connected mesh (shirt sewn to trousers),
        # so connected-component selection would delete the entire blouse.
        bm=bmesh.new();bm.from_mesh(clothes.data)
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,.88),plane_no=(0,0,1),clear_inner=True)
        bm.to_mesh(clothes.data);bm.free()
        top=set(range(len(clothes.data.vertices)))
        # The jeans asset also contains a shirt. Its clothing mask must not
        # hide the retained blouse after that source shirt has been removed.
        for mod in list(clothes.modifiers):
            if mod.type=='MASK':clothes.modifiers.remove(mod)
        if len(clothes.data.polygons)<200:raise RuntimeError('Blouse disappeared during outfit separation')
    if identifier != 'ishbilarmon':
        shade={'yigit':(.095,.093,.087),'qiz':(.71,.64,.51),'ishchi':(.018,.033,.058)}[identifier]
        clothmat=plain_material(identifier+' fabric',shade,.92,clothes.data.materials[0])
        clothes.data.materials.append(clothmat)
        for poly in clothes.data.polygons:
            if poly.vertices[0] in top: poly.material_index=len(clothes.data.materials)-1
        if identifier=='ishchi':
            trousers=plain_material('Navy work trousers',(.018,.027,.045),.94,clothes.data.materials[0])
            clothes.data.materials.append(trousers)
            for poly in clothes.data.polygons:
                if poly.vertices[0] not in top: poly.material_index=len(clothes.data.materials)-1
            vest=clothes.copy();vest.data=clothes.data.copy();bpy.context.collection.objects.link(vest);vest.name='SafetyVest'
            bm=bmesh.new();bm.from_mesh(vest.data)
            # Cut along actual edges, including reflective band boundaries;
            # deleting whole faces alone leaves a visibly jagged vest outline.
            for axis,values in [(0,[-.207,-.153,-.111,-.022,.022,.111,.153,.207]),(2,[.96,1.055,1.11,1.18,1.44])]:
                for value in values:
                    point=[0,0,0];point[axis]=value;normal=[0,0,0];normal[axis]=1
                    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=point,plane_no=normal)
            reject=[]
            for face in bm.faces:
                c=face.calc_center_median()
                if c.z<.96 or c.z>1.44 or abs(c.x)>.207 or (c.y<0 and abs(c.x)<.022): reject.append(face)
            bmesh.ops.delete(bm,geom=reject,context='FACES');bm.to_mesh(vest.data);bm.free()
            for v in vest.data.vertices:v.co.x*=1.06;v.co.y*=1.17;v.co.y-=.005
            vest.data.materials.clear();vest.data.materials.append(plain_material('Safety orange',(.95,.19,.016)))
            vest.data.materials.append(plain_material('Reflective silver',(.58,.61,.61),.43))
            for face in vest.data.polygons:
                c=sum((vest.data.vertices[i].co for i in face.vertices),Vector())/len(face.vertices)
                c.x/=1.06
                face.material_index=1 if (1.055<c.z<1.11 or (abs(abs(c.x)-.132)<.021 and c.z>1.18)) else 0
            cap=HumanService.add_mhclo_asset(asset('clothes','toigo_maga_hat'),body,asset_type='Clothes',subdiv_levels=0,material_type='GAMEENGINE')
            cap.name='NavyWorkCap';cap.data.materials.clear();cap.data.materials.append(plain_material('Navy cap',(.015,.025,.046),.9))
            hair=next(o for o in bpy.context.scene.objects if 'short01' in o.name)
            remove_region(hair,{v.index for v in hair.data.vertices if v.co.z>1.615})
            # Close the deliberately distressed patches in the work trousers.
            bm=bmesh.new();bm.from_mesh(clothes.data)
            edges=[e for e in bm.edges if e.is_boundary and all(.22<v.co.z<.65 for v in e.verts)]
            filled=bmesh.ops.holes_fill(bm,edges=edges,sides=0)
            for face in filled.get('faces',[]):face.material_index=len(clothes.data.materials)-1
            bm.to_mesh(clothes.data);bm.free()
    # Bake macro morphs and remove hidden body geometry under the garments.
    active(body)
    if body.data.shape_keys:bpy.ops.object.shape_key_remove(all=True,apply_mix=True)
    ExportService.bake_modifiers_remove_helpers(body,bake_masks=True,bake_subdiv=False,remove_helpers=True,also_proxy=False)
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for obj in meshes:
        active(obj)
        if obj.data.shape_keys:bpy.ops.object.shape_key_remove(all=True,apply_mix=True)
        for mod in list(obj.modifiers):
            if mod.type=='SUBSURF': obj.modifiers.remove(mod)
            elif mod.type=='MASK':bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in obj.data.polygons:p.use_smooth=True
        # Hair cards use cutout transparency in the game, avoiding per-card sorting.
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:continue
            bsdf=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
            if bsdf:
                bsdf.inputs['Roughness'].default_value=.63 if 'hair' in obj.name.lower() or 'short' in obj.name.lower() else .82
                bsdf.inputs['Metallic'].default_value=0
                bsdf.inputs['Emission Color'].default_value=(0,0,0,1)
    neutral_rest(rig,meshes)
    names={'pelvis':'Hips','spine_01':'Abdomen','spine_02':'Torso','spine_03':'Chest','neck_01':'Neck','head':'Head'}
    for side in ['l','r']:
        for original,target in [('upperarm','UpperArm'),('lowerarm','LowerArm'),('hand','Hand'),('thigh','UpperLeg'),('calf','LowerLeg'),('foot','Foot'),('ball','Toe')]:names[original+'_'+side]=target+'_'+side.upper()
    for old,new in names.items():rig.data.bones[old].name=new
    rig.name='Xarita_'+identifier
    bpy.context.view_layer.update()
    # Keep a fully editable, packed master; the game export stays unsubdivided.
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / (identifier+'-source.blend')))
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(WORK/(identifier+'-raw.glb')),export_format='GLB',use_selection=True,
        export_animations=False,export_apply=False,export_morph=False,export_yup=True,export_extras=True)
    # A second geometry set uses the same rig. The final packer shares its bones.
    for obj in meshes:
        active(obj)
        if len(obj.data.polygons)>160:
            mod=obj.modifiers.new('Distance geometry','DECIMATE');mod.ratio=.3
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(WORK/(identifier+'-lod.glb')),export_format='GLB',use_selection=True,
        export_animations=False,export_apply=False,export_morph=False,export_yup=True,export_extras=True)
    # Render the master rather than the reduced geometry.
    bpy.ops.wm.open_mainfile(filepath=str(WORK/(identifier+'-source.blend')))
    render_preview(identifier)

if __name__ == '__main__':
    requested=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['yigit','qiz','ishbilarmon','ishchi']
    for identifier in requested:create_character(identifier)
