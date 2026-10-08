import {expect,it} from 'vitest';
import {PerspectiveCamera} from 'three';
import {pickPocket,pocketTargets} from '../src/render/pocketPicking';
it.each([320,1280])('pocket black centers and generous rims select at viewport %s',width=>{
 const camera=new PerspectiveCamera(50,width/800,.05,50);camera.position.set(-1.8,2.5,2);camera.lookAt(0,0,0);
 const rect={left:0,top:0,width,height:800};
 const targets=pocketTargets(camera,rect);expect(targets).toHaveLength(6);
 for(const p of targets){expect(p.radius).toBeGreaterThanOrEqual(24);expect(pickPocket(camera,rect,p.x,p.y)).toBe(p.index);expect(pickPocket(camera,rect,p.x+p.radius*.8,p.y)).toBe(p.index);}
 expect(pickPocket(camera,rect,-5000,-5000)).toBeNull();
});
it('does not select a pocket behind the camera',()=>{
 const camera=new PerspectiveCamera(50,1.6,.05,50);camera.position.set(0,2,3);camera.lookAt(0,4,6);
 expect(pocketTargets(camera,{left:0,top:0,width:1280,height:800})).toHaveLength(0);
});
