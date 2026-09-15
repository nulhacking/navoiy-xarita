import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Road bicycle in game metres, +Z forward. Moving assemblies own their geometry. */
export function buildBicycle():Group {
  const bike=new Group();bike.name='Road bicycle';bike.userData.vehicleId='bicycle';
  const paint=new MeshStandardMaterial({color:0xb74d21,metalness:.55,roughness:.3});
  const rubber=new MeshStandardMaterial({color:0x15171a,roughness:.91});
  const alloy=new MeshStandardMaterial({color:0xadb3b8,metalness:.9,roughness:.25});
  const dark=new MeshStandardMaterial({color:0x24292c,metalness:.55,roughness:.38});
  const body=new Group();bike.add(body);
  const tube=(parent:Group,a:number[],b:number[],radius:number,material=paint,segments=10)=>{
    const from=new Vector3(...a),to=new Vector3(...b),direction=to.clone().sub(from);
    const mesh=new Mesh(new CylinderGeometry(radius,radius,direction.length(),segments),material);
    mesh.position.copy(from.add(to).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new Vector3(0,1,0),direction.normalize());parent.add(mesh);return mesh;
  };
  const box=(parent:Group,p:number[],s:number[],material=dark)=>{const m=new Mesh(new BoxGeometry(...s),material);m.position.set(...p as [number,number,number]);parent.add(m);return m;};
  const ring=(parent:Group,p:number[],radius:number,thickness:number,material=alloy,segments=64)=>{
    const mesh=new Mesh(new TorusGeometry(radius,thickness,6,segments),material);mesh.rotation.y=Math.PI/2;mesh.position.set(...p as [number,number,number]);parent.add(mesh);return mesh;
  };
  const bb=[0,.305,.04],seat=[0,.78,-.2],head=[0,.79,.35],headLow=[0,.61,.40];
  tube(body,bb,seat,.019);tube(body,seat,head,.018);tube(body,bb,headLow,.024);tube(body,headLow,head,.021);
  for(const sign of [-1,1]){tube(body,[sign*.025,.76,-.2],[sign*.055,.335,-.585],.01);tube(body,[sign*.048,.305,.04],[sign*.055,.335,-.585],.012);}
  tube(body,[0,.75,-.2],[0,.90,-.24],.013,alloy);
  // Saddle has a broad rear and narrow rounded nose; no extra texture uploads.
  const saddle=new Mesh(new TorusGeometry(.052,.026,8,20,Math.PI),rubber);saddle.rotation.x=Math.PI/2;saddle.position.set(0,.905,-.27);body.add(saddle);
  box(body,[0,.913,-.225],[.13,.035,.13],rubber);box(body,[0,.913,-.12],[.052,.03,.13],rubber);
  for(const x of [-.025,.025])tube(body,[x,.89,-.32],[x,.89,-.10],.003,alloy,6);
  for(const front of [false,true]) {
    const z=front?.585:-.585,pivot=new Group(),spin=new Group();pivot.name=front?'WheelFront':'WheelRear';spin.name='WheelSpin';
    pivot.position.set(0,.335,z);pivot.userData={vehicleWheel:true,front,radius:.335};spin.userData.vehicleSpin=true;pivot.add(spin);bike.add(pivot);
    ring(spin,[0,0,0],.32,.015,rubber);ring(spin,[0,0,0],.303,.009,dark);ring(spin,[0,0,0],.31,.003,alloy);
    tube(spin,[-.048,0,0],[.048,0,0],.024,alloy,16);
    for(let i=0;i<24;i++){const a=i*Math.PI/12; tube(spin,[i%2?.027:-.027,0,0],[0,.298*Math.cos(a),.298*Math.sin(a)],.0014,alloy,4);}
    ring(spin,[.047,0,0],.066,.004,alloy,32);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;tube(spin,[.047,.022*Math.cos(a),.022*Math.sin(a)],[.047,.065*Math.cos(a+.3),.065*Math.sin(a+.3)],.003,alloy,4);}
    if(front){
      const fork=new Group();fork.name='SteeringAssembly';fork.userData.vehicleHandlebar=true;fork.position.set(0,.335,z);bike.add(fork);
      for(const sign of [-1,1]){tube(fork,[sign*.045,0,0],[sign*.036,.20,-.125],.011);tube(fork,[sign*.036,.20,-.125],[sign*.025,.44,-.22],.012);}
      tube(fork,[0,.44,-.22],[0,.585,-.25],.015,dark);tube(fork,[0,.585,-.25],[0,.61,-.16],.014,dark);
      tube(fork,[-.18,.61,-.165],[.18,.61,-.165],.012,dark);
      for(const sign of [-1,1]){
        // Smooth drop bars, brake hoods and levers.
        const points=[[sign*.12,.61,-.165],[sign*.18,.605,-.13],[sign*.20,.57,-.085],[sign*.20,.515,-.075],[sign*.20,.475,-.12],[sign*.20,.475,-.22]];
        for(let j=1;j<points.length;j++)tube(fork,points[j-1],points[j],.013,rubber,12);
        box(fork,[sign*.18,.606,-.155],[.034,.042,.065],rubber);
        tube(fork,[sign*.18,.59,-.10],[sign*.18,.525,-.12],.004,alloy,6);
      }
    }
  }
  // Cranks share the rider's phase; pedals stay level instead of rotating the shoes.
  const crank=new Group();crank.name='BicycleCrank';crank.userData.vehicleCrank=true;crank.position.set(...bb as [number,number,number]);bike.add(crank);
  ring(body,[-.07,.305,.04],.083,.008,dark,40);ring(body,[-.074,.305,.04],.062,.003,alloy,32);
  for(const sign of [-1,1]){
    tube(crank,[sign*.09,0,0],[sign*.11,0,sign*.16],.009,alloy);
    const pedal=new Group();pedal.name=sign>0?'Pedal_L':'Pedal_R';pedal.userData.vehiclePedal=sign;pedal.position.set(sign*.11,0,sign*.16);crank.add(pedal);
    box(pedal,[0,0,0],[.085,.022,.07],dark);for(const z of [-.027,.027])tube(pedal,[-.04,.012,z],[.04,.012,z],.0025,alloy,6);
  }
  // Two straight chain runs, chainstay-mounted derailleur and brake cables.
  tube(body,[-.077,.385,.04],[-.077,.38,-.585],.0025,dark,6);tube(body,[-.077,.224,.04],[-.077,.29,-.585],.0025,dark,6);
  tube(body,[-.065,.335,-.585],[-.075,.235,-.53],.012,dark,8);
  tube(body,[.023,.77,-.18],[.023,.78,.33],.002,rubber,6);
  // Merge static geometry per material and assembly, keeping hinges intact.
  bike.updateMatrixWorld(true);
  const groups:Group[]=[];bike.traverse(n=>{if(n instanceof Group)groups.push(n);});
  for(const parent of groups){const batches=new Map<MeshStandardMaterial,Mesh[]>();for(const child of [...parent.children])if(child instanceof Mesh){const mat=child.material as MeshStandardMaterial;const list=batches.get(mat)??[];list.push(child);batches.set(mat,list);}
    for(const [material,meshes]of batches){const geometries=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(mesh.matrix));const geometry=mergeGeometries(geometries);for(const g of geometries)g.dispose();if(!geometry)throw new Error('Bicycle mesh merge failed');for(const mesh of meshes){parent.remove(mesh);mesh.geometry.dispose();}const mesh=new Mesh(geometry,material);mesh.castShadow=true;parent.add(mesh);}
  }
  return bike;
}
