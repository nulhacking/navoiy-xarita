"""Reference sedan/SUV: shaped panels, open cabin, optical assemblies and pivots.

Coordinates in authoring helpers use the game's X / up Y / forward Z convention.
Blender masters and separate high/low geometry exports are retained for editing.
"""
import bpy, bmesh, math, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'artifacts/blender-work'
def v(p):return Vector((p[0],-p[2],p[1]))
def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
def material(name,color,rough=.4,metal=0,alpha=1):
    m=bpy.data.materials.new(name);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
    bs.inputs['Alpha'].default_value=alpha
    if name=='Paint':bs.inputs['Coat Weight'].default_value=.8;bs.inputs['Coat Roughness'].default_value=.18
    if alpha<1:m.surface_render_method='BLENDED';m.use_transparency_overlap=False
    return m
def empty(name,point=(0,0,0),parent=None,**extras):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o)
    o.location=v(point);o.parent=parent
    if parent:o.location-=parent.matrix_world.translation
    for k,value in extras.items():o[k]=value
    bpy.context.view_layer.update();return o
def mesh(name,points,faces,mat,parent=None,bevel=0):
    data=bpy.data.meshes.new(name);data.from_pydata([v(p) for p in points],[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
    for face in data.polygons:face.use_smooth=True
    if bevel:
        mod=o.modifiers.new('Panel edge radius','BEVEL');mod.width=bevel;mod.segments=3
        active(o);bpy.ops.object.modifier_apply(modifier=mod.name)
    return o
def grid(name,fn,nu,nv,mat,parent=None):
    pts=[fn(i/nu,j/nv) for i in range(nu+1) for j in range(nv+1)]
    faces=[(i*(nv+1)+j,(i+1)*(nv+1)+j,(i+1)*(nv+1)+j+1,i*(nv+1)+j+1) for i in range(nu) for j in range(nv)]
    return mesh(name,pts,faces,mat,parent)
def cube(name,pos,size,mat,parent=None,r=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=v(pos));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);active(o)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if r:
        mod=o.modifiers.new('Soft edges','BEVEL');mod.width=r;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Panel normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat)
    for face in o.data.polygons:face.use_smooth=True
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
    return o
def tube(name,points,r,mat,parent=None,closed=False):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=2
    curve.bevel_depth=r;curve.bevel_resolution=2
    spline=curve.splines.new('POLY');spline.points.add(len(points)-1)
    for p,co in zip(spline.points,points):p.co=(*v(co),1)
    spline.use_cyclic_u=closed
    o=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    active(o);bpy.ops.object.convert(target='MESH')
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
    return o
def axis_cylinder(name,center,r,depth,mat,axis=(1,0,0),parent=None,segments=40):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments,radius=r,depth=depth,location=v(center));o=bpy.context.object;o.name=name
    o.rotation_euler=Vector((0,0,1)).rotation_difference(v(axis)).to_euler();o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
    return o
def smoothstep(x):return x*x*(3-2*x)
def lerp(a,b,t):return a+(b-a)*t
def interpolate(stations,z,col):
    for i in range(len(stations)-1):
        a,b=stations[i:i+2]
        if z<=b[0]:return lerp(a[col],b[col],smoothstep(max(0,(z-a[0])/(b[0]-a[0]))))
    return stations[-1][col]
def vehicle(identifier):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    suv=identifier=='suv';L=2.325 if suv else 2.25;w=.935 if suv else .88;R=.355 if suv else .32
    belt=1.12 if suv else 1.0;roof=1.71 if suv else 1.48
    zfront=.92;zrear=-1.78 if suv else -1.49;rf=.28;rr=-1.2 if suv else -.72;rw=w*.79
    paint=material('Paint',(.70,.72,.70) if suv else (.22,.43,.57),.23,.48)
    trim=material('Trim',(.013,.017,.021),.6)
    rubber=material('Rubber',(.009,.011,.014),.91)
    alloy=material('Alloy',(.52,.57,.62),.27,.85)
    glass=material('Windows',(.13,.19,.22),.12,.12,.26)
    lens=material('OpticalGlass',(.68,.77,.8),.1,.24,.25)
    interior=material('Interior',(.026,.031,.036),.91)
    red=material('RearLens',(.38,.009,.014),.21,.1)
    white=material('Reflector',(.8,.84,.83),.2,.45)
    amber=material('Amber',(.8,.2,.008),.2,.1)
    plate=material('Plate',(.78,.8,.76),.6)
    # The approved turnaround supplies fine optical/grille detail on the
    # shaped 3D parts. Body paint and windows remain lit PBR surfaces.
    reference=bpy.data.images.load(str(ROOT/'artifacts/avatar-turnarounds'/('06-suv.png' if suv else '05-sedan.png')),check_existing=True)
    lamp_photo=material('HeadlampDetail',(.8,.8,.8),.25,.2)
    grille_photo=material('GrilleDetail',(.5,.5,.5),.4,.2)
    for detail in [lamp_photo,grille_photo]:
        tex=detail.node_tree.nodes.new('ShaderNodeTexImage');tex.image=reference
        detail.node_tree.links.new(tex.outputs['Color'],detail.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    root=empty('Xarita_'+identifier,vehicleId=identifier,referenceModel=True,forward='+Z',modelMethod='Blender shaped panels')
    chassis=empty('Chassis',parent=root)
    # The shoulder follows the reference silhouette. Wheel cutouts only affect
    # the fenders, never the hood or the transverse floor of the car.
    stations=[(-L,belt-.065,w*.91),(-L+.3,belt+.005,w*.99),(-1.6,belt+.015,w),(-.9,belt+.025,w),(.2,belt+.025,w),(.92,belt,w*.995),(1.55,belt-.06,w), (L-.3,belt-.115,w*.995),(L,belt-.17,w*.95)]
    def top(z):return interpolate(stations,z,1)
    def width(z):return interpolate(stations,z,2)
    def lower(z):
        h=.29 if suv else .225
        for axle in [1.34,-1.33]:
            d=abs(z-axle);radius=R+.055
            if d<radius:h=max(h,R+math.sqrt(radius*radius-d*d))
        return h
    def side(sign,z,t):
        y=lerp(lower(z),top(z),t)
        # Convex shoulder, a restrained belt crease and a tucked-in lower door.
        h=max(0,min(1,(y-(.29 if suv else .225))/(belt-(.29 if suv else .225))))
        bulge=.024*math.sin(math.pi*h)-.012*math.sin(math.pi*h*2)-.008*math.exp(-((h-.29)/.14)**2)
        x=sign*(width(z)-.065*(1-t)+bulge)
        retreat=(.27+.035*((y-.52)/.35)**2)*(max(0,(abs(z)-(L-.35)))/.35)**2
        return (x,y,z-math.copysign(retreat,z))
    doors=[]
    for sign,letter in [(1,'L'),(-1,'R')]:
        front=empty('DoorFront_'+letter,(sign*w,.7,.89),root,vehicleDoor=True,left=sign>0,front=True)
        rear=empty('DoorRear_'+letter,(sign*w,.7,-.25),root,vehicleDoor=True,left=sign>0,front=False)
        doors.extend([front,rear])
        for label,lo,hi,parent in [('RearQuarter',-L,-1.09,chassis),('RearDoor',-1.09,-.25,rear),('FrontDoor',-.25,.89,front),('FrontFender',.89,L,chassis)]:
            grid(label+letter,lambda u,t,lo=lo,hi=hi:side(sign,lerp(lo,hi,u),t),40,10,paint,parent)
        # Door shut lines and side sill retain the same curved panel surface.
        for z in [-1.09,-.25,.89]:tube('DoorSeal',[side(sign,z,t) for t in [i/24 for i in range(25)]],.0035,trim,chassis)
        tube('Sill',[side(sign,z,.02) for z in [-.9,-.5,0,.5,.9]],.023,trim if suv else paint,chassis)
        for axle in [1.34,-1.33]:
            points=[]
            for i in range(49):
                a=math.pi*i/48;z=axle+(R+.055)*math.cos(a);y=R+(R+.055)*math.sin(a)
                points.append((sign*(width(z)+.006),y,z))
            tube('WheelArch',points,.024 if suv else .014,trim if suv else paint,chassis)
            # Dark arch liner behind the body lip.
            tube('ArchLiner',[(p[0]-sign*.027,p[1]-.01,p[2]) for p in points],.023,rubber,chassis)
        for door,z in [(front,-.04),(rear,-.85)]:
            panel_x=side(sign,z,(belt-.12-lower(z))/(top(z)-lower(z)))[0]
            cube('HandleRecess',(panel_x+sign*.01,belt-.12,z),(.012,.067,.205),trim,door,.025)
            cube('DoorHandle',(panel_x+sign*.026,belt-.107,z+.005),(.035,.034,.185),paint,door,.014)
        # Window openings, with inward taper and curved roofline.
        frontPts=[(sign*w*.975,belt+.01,.88),(sign*w*.985,belt+.025,-.23),(sign*rw,roof-.06,-.23),(sign*rw,roof-.11,.23)]
        rearPts=[(sign*w*.985,belt+.025,-.28),(sign*w*.96,belt+.02,-1.36 if suv else -1.15),(sign*rw,roof-.1,rr+.07),(sign*rw,roof-.06,-.28)]
        for door,pts in [(front,frontPts),(rear,rearPts)]:
            mesh('SideGlass',pts,[(0,1,2,3)],glass,door)
            tube('WindowGasket',pts,.012,trim,door,True)
            tube('WindowChrome',[(p[0]+sign*.008,p[1]-.019,p[2]) for p in pts[:2]],.007,alloy,door)
        tube('BPillar',[(sign*w*.98,belt,-.255),(sign*rw,roof-.05,-.255)],.033,trim,chassis)
        if suv:
            quarter=[(sign*w*.956,belt+.02,-1.4),(sign*w*.87,belt+.05,-1.83),(sign*rw,roof-.17,-1.44),(sign*rw,roof-.105,-1.27)]
            mesh('QuarterGlass',quarter,[(0,1,2,3)],glass,chassis);tube('QuarterFrame',quarter,.029,trim,chassis,True)
        # Wide pressed pillar strips avoid the tubular roll-cage silhouette.
        grid('APillar',lambda u,t:(sign*(lerp(w*.962,rw,u)+lerp(-.018,.018,t)),lerp(belt+.01,roof-.04,u),lerp(.91,.28,u)+lerp(-.022,.022,t)),16,2,paint,chassis)
        tube('CPillar',[(sign*w*.96,belt,zrear),(sign*rw,roof-.09,rr)],.067 if suv else .072,paint,chassis)
        if not suv:
            mesh('CQuarterPanel',[(sign*w*.96,belt,zrear),(sign*w*.96,belt,-1.12),(sign*rw,roof-.095,rr+.085),(sign*rw,roof-.045,rr)],[(0,1,2,3)],paint,chassis)
        tube('RoofEdge',[(sign*rw,roof-.025*math.cos(math.pi*i/20*2),lerp(rr,rf,i/20)) for i in range(21)],.012,paint,chassis)
        # Door cards turn with their hinges and hide the outer skin's reverse face.
        for door,lo,hi in [(front,-.22,.81),(rear,-1.02,-.3)]:
            cube('DoorCard',(sign*(w-.045),belt-.22,(lo+hi)/2),(.045,.38,hi-lo),interior,door,.035)
            cube('ArmRest',(sign*(w-.105),belt-.25,(lo+hi)/2),(.12,.065,.42),trim,door,.027)
        # Sculpted side mirror and its dark underside.
        cube('MirrorMount',(sign*(w+.015),belt+.08,.77),(.13,.055,.15),trim,front,.025)
        cube('MirrorHousing',(sign*(w+.12),belt+.115,.77),(.2,.12,.21),paint,front,.052)
        cube('MirrorGlass',(sign*(w+.12),belt+.115,.671),(.16,.077,.008),alloy,front,.025)
        if suv:
            tube('RoofRail',[(sign*.66,roof+.055,z) for z in [-1.35,-1.15,-.65,-.1,.35]],.022,trim,chassis)
            for z in [-1.29,.29]:cube('RailFoot',(sign*.66,roof+.015,z),(.08,.08,.16),trim,chassis,.03)
    # Broad hood and trunk panels use genuine curved surfaces, with visible seams.
    for label,lo,hi in [('Hood',zfront,L),('Trunk',-L,zrear)]:
        def hood(u,t):
            z=lerp(lo,hi,u);x=lerp(-width(z),width(z),t);y=top(z)+.045*math.sin(math.pi*t)
            blend=max(0,(abs(z)-(L-.35))/.35)**2
            z-=math.copysign(blend*(.27*(abs(x)/(w*.95))**4+.035*((y-.52)/.35)**2),z)
            return x,y,z
        grid(label,hood,40,18,paint,chassis)
    for sign in [-1,1]:
        pts=[]
        for i in range(41):
            z=lerp(zfront,L-.06,i/40);x=sign*width(z)*.8;y=top(z)+.045*math.sin(math.pi*.9)
            z-=max(0,(z-(L-.35))/.35)**2*(.27*(abs(x)/(w*.95))**4+.035*((y-.52)/.35)**2)
            pts.append((x,y+.002,z))
        tube('HoodSeam',pts,.0018,trim,chassis)
    # Gently domed roof, curved windshield, and corresponding rear window.
    grid('Roof',lambda u,t:(lerp(-rw,rw,t),roof+.029*math.sin(math.pi*t)-.025*math.cos(math.pi*u*2),lerp(rr,rf,u)),28,18,paint,chassis)
    def screen(u,t,rear=False):
        base=zrear if rear else zfront;end=rr if rear else rf
        x=lerp(-1,1,t)*lerp(w*.91,rw,u);y=lerp(belt+.028,roof-.04,u)+.018*math.sin(math.pi*t)
        z=lerp(base,end,u)+(.025 if not rear else -.025)*math.sin(math.pi*t)
        return x,y,z
    for rear in [False,True]:
        grid('RearGlass' if rear else 'Windscreen',lambda u,t:screen(u,t,rear),15,24,glass,chassis)
        perimeter=[screen(0,t,rear) for t in [i/24 for i in range(25)]]+[screen(u,1,rear) for u in [i/16 for i in range(1,17)]]+[screen(1,t,rear) for t in [1-i/24 for i in range(1,25)]]+[screen(u,0,rear) for u in [1-i/16 for i in range(1,17)]]
        tube('WindscreenSeal',perimeter,.011,trim,chassis,True)
    # Front and rear bumpers curve around the corners instead of forming a box.
    def end_surface(x,y,back=False):
        zn=-L if back else L
        # Fascia changes section below the grille and around the lower intake;
        # the hood's leading edge stays continuous with the bumper.
        contour=0 if back else -.055*math.exp(-((y-(belt-.39))/.075)**2)+.028*math.exp(-((y-.34)/.07)**2)
        return x,y,zn+(-1 if back else 1)*(-.27*(abs(x)/(w*.95))**4-.035*((y-.52)/.35)**2+contour)
    for back in [False,True]:
        grid('RearBumper' if back else 'FrontBumper',lambda u,t:end_surface(lerp(-w*(.91 if back else .95),w*(.91 if back else .95),u),lerp((.28 if suv else .225)+.025*abs(2*u-1)**4,top(-L if back else L)+.045*math.sin(math.pi*u),t),back),48,22,paint,chassis)
    def frontal_polygon(name,coords,mat,back=False,offset=.014):
        pts=[]
        for x,y in coords:
            p=end_surface(x,y,back);pts.append((p[0],p[1],p[2]+(-offset if back else offset)))
        o=mesh(name,pts,[tuple(range(len(pts)))],mat,chassis)
        # Follow the bumper curvature throughout the lens/intake, including its
        # interior. A flat polygon disappears behind the convex painted panel.
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces))
        bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=5,use_grid_fill=True)
        for vertex in bm.verts:
            x,y=vertex.co.x,vertex.co.z
            vertex.co.y=-(end_surface(x,y,back)[2]+(-offset if back else offset))
        bm.to_mesh(o.data);bm.free();o.data.update()
        if mat in [lamp_photo,grille_photo]:
            uv=o.data.uv_layers.new(name='Optical detail')
            for loop in o.data.loops:
                co=o.data.vertices[loop.vertex_index].co;x,y=co.x,co.z
                if mat==lamp_photo:
                    left,right,yt,yb=(528,628,204,264) if suv else (539,644,221,274)
                    px=lerp(left,right,(abs(x)-.44)/.365);py=lerp(yb,yt,(y-(belt-.34))/.195)
                else:
                    left,right,yt,yb=(297,519,224,282) if suv else (320,528,232,282)
                    px=lerp(left,right,(x+.41)/.82);py=lerp(yb,yt,(y-(belt-.375))/.175)
                uv.data[loop.index].uv=(px/1536,1-py/1024)
        return pts
    grille=[(-.41,belt-.2),(.41,belt-.2),(.395,belt-.265),(.35,belt-.36),(.3,belt-.375),(-.3,belt-.375),(-.35,belt-.36),(-.395,belt-.265)]
    border=frontal_polygon('MainGrille',grille,grille_photo);tube('GrilleChrome',border,.009,alloy,chassis,True)
    for i in range(4):
        y=belt-.235-i*.043
        half=.37-i*.014
        tube('GrilleSlat',[end_surface(x,y)[:2]+(end_surface(x,y)[2]+.026,) for x in [-half,-half*.5,0,half*.5,half]],.006,alloy if i==0 else trim,chassis)
    low=[(-.48,.47),(.48,.47),(.59,.31),(-.59,.31)]
    frontal_polygon('LowerIntake',low,trim)
    for i in range(3):tube('LowerSlat',[(x,.335+i*.045,end_surface(x,.335+i*.045)[2]+.019) for x in [-.45,-.225,0,.225,.45]],.006,trim,chassis)
    for sign in [-1,1]:
        # Reflector bowls, two projector lenses and indicator behind each cover.
        coords=[(sign*.44,belt-.34),(sign*.47,belt-.24),(sign*.55,belt-.177),(sign*.72,belt-.145),(sign*.79,belt-.165),(sign*.805,belt-.21),(sign*.78,belt-.295),(sign*.72,belt-.315)]
        pts=frontal_polygon('HeadlightHousing',coords,alloy,offset=.018);tube('HeadlightSeal',pts,.006,trim,chassis,True)
        for cx,rad in [(sign*.535,.043),(sign*.662,.051)]:
            cy=belt-.26 if abs(cx)<.6 else belt-.235;cz=end_surface(cx,cy)[2]+.028
            axis_cylinder('ReflectorBowl',(cx,cy,cz),rad,.016,alloy,axis=(0,0,1),parent=chassis,segments=32)
            axis_cylinder('ProjectorLens',(cx,cy,cz+.012),rad*.67,.012,white,axis=(0,0,1),parent=chassis,segments=32)
            # Radial micro facets catch the environment without an expensive shader.
            for j in range(12):
                a=j*math.tau/12
                tube('ReflectorRidge',[(cx+rad*.7*math.cos(a),cy+rad*.7*math.sin(a),cz+.013),(cx+rad*.96*math.cos(a),cy+rad*.96*math.sin(a),cz+.003)],.0018,alloy,chassis)
        frontal_polygon('HeadlightCover',coords,lamp_photo,offset=.056)
        fog=frontal_polygon('FogRecess',[(sign*.59,.31),(sign*.78,.34),(sign*.8,.49),(sign*.62,.46)],trim)
        axis_cylinder('FogReflector',(sign*.7,.4,end_surface(sign*.7,.4)[2]+.025),.043,.016,alloy,(0,0,1),chassis,28)
        axis_cylinder('FogLens',(sign*.7,.4,end_surface(sign*.7,.4)[2]+.038),.029,.01,white,(0,0,1),chassis,24)
        rearpts=frontal_polygon('TailLamp',[(sign*.49,belt-.03),(sign*.8,belt+.01),(sign*.83,belt-.2),(sign*.59,belt-.22)],red,True,.035)
        tube('TailLampSeal',rearpts,.006,trim,chassis,True)
        frontal_polygon('ReverseLens',[(sign*.61,belt-.14),(sign*.8,belt-.11),(sign*.8,belt-.18),(sign*.63,belt-.19)],white,True,.044)
        brake=cube('Brake_'+str(sign),(sign*.685,belt-.075,-L-.027),(.19,.055,.009),red,root,.018);brake['brakeLight']=True
        for z in [L,-L]:
            indicator=cube('Indicator_'+str(sign)+'_'+str(z),(sign*.8,belt-.105,z),(.045,.08,.012),amber,root,.009);indicator['indicator']=sign
    for back in [False,True]:
        z=-L-.026 if back else L+.025
        cube('LicensePlate',(0,.64 if suv else .61,z),(.46,.14,.014),plate,chassis,.009)
        for x in [-.185,.185]:axis_cylinder('PlateScrew',(x,.68 if suv else .65,z+(-.01 if back else .01)),.004,.002,alloy,(0,0,1),chassis,8)
    if suv:
        cube('LowerBumperTrim',(0,.3,-L+.025),(1.42,.22,.16),trim,chassis,.07)
        cube('SkidPlate',(0,.245,-L-.055),(.8,.105,.055),alloy,chassis,.035)
        cube('RoofSpoiler',(0,roof-.055,-1.72),(1.42,.05,.23),paint,chassis,.025)
    axis_cylinder('Exhaust',(.59,.24,-L-.035),.037,.2,alloy,(0,0,1),chassis,20)
    # Interior geometry remains present through open doors and transparent glass.
    cube('Floor',(0,.24,-.3),(w*1.77,.055,2.8),trim,chassis,.025)
    for sign in [-1,1]:
        for z in [-.04,-.91]:
            h=.53 if suv else .36
            cube('SeatCushion',(sign*.36,h,z),(.48,.135,.51),interior,chassis,.062)
            seat=cube('SeatBack',(sign*.36,h+.36,z-.23),(.47,.61,.15),interior,chassis,.069);seat.rotation_euler.x=-.10
            cube('Headrest',(sign*.36,h+.76,z-.255),(.27,.195,.135),interior,chassis,.043)
            for xx in [-.19,.19]:cube('SeatBolster',(sign*.36+xx,h+.015,z),(.072,.15,.44),interior,chassis,.033)
    cube('Dashboard',(0,belt-.1,.64),(w*1.75,.19,.33),trim,chassis,.06)
    cube('Console',(0,.49,.07),(.21,.21,.57),trim,chassis,.035)
    cube('Infotainment',(0,belt-.075,.44),(.25,.12,.01),interior,chassis,.009)
    cube('InteriorMirror',(0,roof-.15,.43),(.23,.07,.04),trim,chassis,.023)
    steering=empty('SteeringWheel',(.36,1.14 if suv else .97,.38),root)
    cy=1.14 if suv else .97
    tube('SteeringRim',[(.36+.17*math.cos(a),cy+.17*math.sin(a),.38) for a in [i*math.tau/48 for i in range(48)]],.016,trim,steering,True)
    cube('Airbag',(.36,cy,.38),(.12,.095,.04),trim,steering,.033)
    for x,y in [(.2,cy),(.52,cy),(.36,cy-.15)]:tube('SteeringSpoke',[(.36,cy,.38),(x,y,.38)],.012,trim,steering)
    # Wheels: barrel, brake disc, 10 cast spokes, bead, tread and five wheel bolts.
    for sign,letter in [(1,'L'),(-1,'R')]:
        for front,z in [(True,1.34),(False,-1.33)]:
            x=sign*(w-.055);point=(x,R,z);which='Front' if front else 'Rear'
            pivot=empty('Wheel'+which+'_'+letter,point,root,vehicleWheel=True,front=front,radius=R)
            spin=empty('WheelSpin_'+which+'_'+letter,point,pivot,vehicleSpin=True)
            # Rounded radial profile gives a flat tread and realistic sidewalls.
            profile=[(-.108,R*.7),(-.11,R*.83),(-.098,R*.965),(-.07,R),(.07,R),(.098,R*.965),(.11,R*.83),(.108,R*.7)]
            pts=[]
            for i in range(65):
                a=i*math.tau/64
                for offset,radius in profile:pts.append((x+offset,R+radius*math.cos(a),z+radius*math.sin(a)))
            faces=[(i*8+j,(i+1)*8+j,(i+1)*8+j+1,i*8+j+1) for i in range(64) for j in range(7)]
            mesh('Tyre',pts,faces,rubber,spin)
            axis_cylinder('RimBarrel',point,R*.715,.19,alloy,parent=spin)
            tube('RimLip',[(x+sign*.111,R+R*.70*math.cos(a),z+R*.70*math.sin(a)) for a in [j*math.tau/64 for j in range(64)]],.009,alloy,spin,True)
            axis_cylinder('BrakeDisc',(x+sign*.097,R,z),R*.59,.008,trim,parent=spin)
            axis_cylinder('Hub',(x+sign*.116,R,z),.052,.022,alloy,parent=spin,segments=24)
            for j in range(10):
                a=j*math.tau/10
                p=[]
                for radius,ang,depth in [(.053,a-.14,.123),(R*.65,a-.075,.111),(R*.665,a+.06,.1),(.057,a+.25,.123)]:p.append((x+sign*depth,R+radius*math.cos(ang),z+radius*math.sin(ang)))
                mesh('CastSpoke',p,[(0,1,2,3)],alloy,spin,bevel=.002)
            for j in range(5):
                a=j*math.tau/5;axis_cylinder('WheelBolt',(x+sign*.132,R+.038*math.cos(a),z+.038*math.sin(a)),.006,.012,trim,parent=spin,segments=8)
            for j in range(48):
                a=j*math.tau/48
                for shift in [-.05,.05]:
                    points=[(x+shift+dx,R+(R+.0009)*math.cos(a+da),z+(R+.0009)*math.sin(a+da)) for dx,da in [(-.021,-.028),(.021,.028)]]
                    tube('TreadGroove',points,.0015,trim,spin)
    for sign,letter in [(1,'L'),(-1,'R')]:
        point=(sign*.34,belt+.04,.92);pivot=empty('Wiper_'+letter,point,root)
        tube('WiperArm',[point,(sign*.15,belt+.052,.902),(sign*-.03,belt+.059,.895)],.005,trim,pivot)
        tube('WiperBlade',[(sign*.28,belt+.067,.887),(sign*-.03,belt+.065,.893),(sign*-.32,belt+.06,.903)],.008,trim,pivot)
    # Merge only inside an assembly and material: all moving hinges stay intact.
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        if o.type=='MESH':o.data.validate();o.data.update()
    parents=[o for o in bpy.context.scene.objects if o.type=='EMPTY']
    for parent in parents:
        bins={}
        for child in list(parent.children):
            if child.type=='MESH' and not ('brakeLight' in child or 'indicator' in child):bins.setdefault(child.data.materials[0],[]).append(child)
        for mat,objects in bins.items():
            active(objects[0])
            for o in objects:o.select_set(True)
            bpy.ops.object.join();o=bpy.context.object;o.name=parent.name+'_'+mat.name
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='SELECT');bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(identifier+'-source.blend')))
    bpy.ops.export_scene.gltf(filepath=str(WORK/(identifier+'-raw.glb')),export_format='GLB',export_animations=False,export_yup=True,export_extras=True)
    for o in list(bpy.context.scene.objects):
        if o.type=='MESH' and len(o.data.polygons)>100:
            active(o);mod=o.modifiers.new('Distant geometry','DECIMATE');mod.ratio=.28;bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.export_scene.gltf(filepath=str(WORK/(identifier+'-lod.glb')),export_format='GLB',export_animations=False,export_yup=True,export_extras=True)
    print('VEHICLE DONE',identifier)
if __name__=='__main__':
    for identifier in (sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['sedan','suv']):vehicle(identifier)
