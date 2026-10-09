import {describe,expect,it} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {CHALK_POSITIONS,CHALK_PICK_RADIUS,CHALK_SIZE,chalkGeometry,createChalks} from '../src/render/chalk';
import {POCKETS,TABLE_H,TABLE_W} from '../src/sim/table';

describe('rail chalk',()=>{
  it('keeps its generous pick spheres beyond the felt and clear of pocket mouths',()=>{
    for(const p of CHALK_POSITIONS) {
      expect(Math.abs(p.z)-CHALK_PICK_RADIUS).toBeGreaterThan(TABLE_H/2);
      for(const pocket of POCKETS)expect(Math.hypot(p.x-(pocket.x-TABLE_W/2),p.z-(pocket.y-TABLE_H/2))-CHALK_SIZE).toBeGreaterThan(pocket.r+.012);
    }
  });
  it('has a recessed top face with upward facing normals',()=>{
    const geometry=chalkGeometry(),positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
    expect(positions.getY(0)).toBeCloseTo(CHALK_SIZE-.004,6);
    expect(positions.getY(16*64)).toBeCloseTo(CHALK_SIZE,6);
    expect(normals.getY(8*64)).toBeGreaterThan(.5);
    geometry.dispose();
  });
  it('only picks enabled chalk, including generous targets and an offset canvas',()=>{
    const chalk=createChalks(),camera=new PerspectiveCamera(50,1,.05,50);
    camera.position.set(0,3,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const rect={left:100,top:80,width:800,height:800};
    const pixel=(point:Vector3)=>{const p=point.clone().project(camera);return [rect.left+(p.x+1)*rect.width/2,rect.top+(1-p.y)*rect.height/2] as const;};
    for(const position of CHALK_POSITIONS) {
      const [x,y]=pixel(position.clone().add(new Vector3(.03,CHALK_SIZE/2,0)));
      expect(chalk.pick(camera,rect,x,y)).toBe(false);
      chalk.set(true);
      expect(chalk.pick(camera,rect,x,y)).toBe(true);
      expect(chalk.pick(camera,rect,...pixel(new Vector3()))).toBe(false);
      chalk.set(false);
    }
    chalk.set(true);expect(chalk.pick(camera,rect,-1,-1)).toBe(false);
  });
});
