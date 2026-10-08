import {expect,it,vi} from 'vitest';
import {PerspectiveCamera,Scene,Texture,Vector3} from 'three';
import {coinEntry,coinPose,GoldCoin,COIN_REST_Y,COIN_LAND_TIME} from '../src/render/goldCoin';
it.each([.4,1,1.8])('starts outside either side of a camera with aspect %s',aspect=>{
  const camera=new PerspectiveCamera(50,aspect,.05,50);camera.position.set(-1.8,2.5,2);camera.lookAt(0,0,0);
  for(const side of [-1,1] as const){const entry=coinEntry(camera,side);expect(entry.clone().project(camera).x*side).toBeGreaterThan(1.4);expect(entry.y).toBeGreaterThan(0);}
});
it.each([0,1] as const)('lands flat on the felt with seat %s facing up',seat=>{
  const entry=new Vector3(-3,.4,1),flight=coinPose(entry,.4,seat),landed=coinPose(entry,COIN_LAND_TIME,seat);
  expect(flight.position.y).toBeGreaterThan(.3);expect(landed.position.toArray()).toEqual([0,COIN_REST_Y,0]);
  const normal=new Vector3(0,seat===0?1:-1,0).applyQuaternion(landed.rotation);
  expect(normal.y).toBeCloseTo(1,8);expect(Math.abs(normal.x)+Math.abs(normal.z)).toBeLessThan(1e-8);
  expect(coinPose(entry,2,seat).position).toEqual(landed.position);
});
it('cancellation disposes textures and geometry and removes the decorative mesh',()=>{
  const scene=new Scene(),camera=new PerspectiveCamera(50,1,.05,50);camera.position.set(0,2,3);camera.lookAt(0,0,0);
  const textures:Texture[]=[];const coin=new GoldCoin(scene,camera,()=>{const t=new Texture();vi.spyOn(t,'dispose');textures.push(t);return t;});
  coin.begin(0);expect(coin.group.children).toHaveLength(3);
  const geometries=coin.group.children.map(m=>(m as any).geometry);const dispose=vi.spyOn(geometries[0],'dispose');
  coin.clear();expect(coin.group.visible).toBe(false);expect(coin.group.children).toHaveLength(0);expect(dispose).toHaveBeenCalledOnce();
  for(const texture of textures)expect(texture.dispose).toHaveBeenCalledOnce();
  coin.begin(1);coin.advance(0,true);expect(coin.group.position.y).toBe(COIN_REST_Y);
  coin.dispose();expect(scene.children).not.toContain(coin.group);
});

it('keeps a finite offscreen entry when the camera looks away from the table',()=>{
 const camera=new PerspectiveCamera(50,1.6,.05,50);camera.position.set(0,2,3);camera.lookAt(0,4,6);
 const entry=coinEntry(camera,1);expect(entry.toArray().every(Number.isFinite)).toBe(true);expect(entry.clone().project(camera).x).toBeGreaterThan(1.4);
});
