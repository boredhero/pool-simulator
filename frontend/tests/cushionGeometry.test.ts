import { expect,it } from 'vitest';
import { Mesh,MeshBasicMaterial,Raycaster,Vector3 } from 'three';
import { cushionGeometry } from '../src/render/cushionGeometry';
import { cushions,TABLE_W,TABLE_H } from '../src/sim/table';

it('has outward-facing cloth over every rail and its rounded jaw ends',()=>{
  for(const c of cushions()) {
    const mesh=new Mesh(cushionGeometry(c),new MeshBasicMaterial());mesh.updateMatrixWorld();
    const horizontal=c.y1===c.y2,nx=horizontal?0:c.x1===0?-1:1,nz=horizontal?(c.y1===0?-1:1):0;
    for(const t of [.002,.5,.998]) {
      const x=c.x1+(c.x2-c.x1)*t,z=c.y1+(c.y2-c.y1)*t;
      const hit=new Raycaster(new Vector3(x+nx*.015-TABLE_W/2,.2,z+nz*.015-TABLE_H/2),new Vector3(0,-1,0)).intersectObject(mesh);
      expect(hit.length, JSON.stringify({c,x,z})).toBeGreaterThan(0);expect(hit[0].point.y).toBeGreaterThan(.035);
    }
    // No loose jaw cap can intrude into another rail or float above the cloth.
    const pos=mesh.geometry.getAttribute('position');
    for(let i=0;i<pos.count;i++)expect(pos.getY(i)).toBeLessThanOrEqual(.049001);
  }
});
