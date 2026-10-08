import * as THREE from 'three';

const rgb = (hex:string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const clamp=(n:number)=>Math.max(0,Math.min(255,Math.round(n)));
function canvas(w:number,h:number) {
  const image=document.createElement('canvas');image.width=w;image.height=h;
  const ctx=image.getContext('2d')!;return {image,ctx,pixels:ctx.createImageData(w,h)};
}
function map(image:HTMLCanvasElement, color:boolean, x:number,y:number,anisotropy:number) {
  const result=new THREE.CanvasTexture(image);result.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;
  result.wrapS=result.wrapT=THREE.RepeatWrapping;result.repeat.set(x,y);result.anisotropy=anisotropy;return result;
}
const noise=(x:number,y:number)=>{let n=Math.imul(x+17,374761393)^Math.imul(y+71,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};

/** Fine, tightly woven worsted cloth; color never changes its height field. */
export function feltTextures(base:string,anisotropy=4) {
  const size=512,albedo=canvas(size,size),height=canvas(size,size),color=rgb(base);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const weave=Math.sin(x*Math.PI/2)*Math.sin(y*Math.PI/2);
    const fiber=noise(x,y)-.5;
    const shade=1+weave*.018+fiber*.065;
    const offset=(y*size+x)*4,h=clamp(128+weave*17+fiber*18);
    for(let c=0;c<3;c++){albedo.pixels.data[offset+c]=clamp(color[c]*shade);height.pixels.data[offset+c]=h;}
    albedo.pixels.data[offset+3]=height.pixels.data[offset+3]=255;
  }
  albedo.ctx.putImageData(albedo.pixels,0,0);height.ctx.putImageData(height.pixels,0,0);
  return {map:map(albedo.image,true,3,3,anisotropy),bump:map(height.image,false,3,3,anisotropy)};
}

/** Seamless longitudinal grain; tiny pores, correlated relief and finish. */
export function woodTextures(base:string,anisotropy=4) {
  const width=1024,height=256,albedo=canvas(width,height),relief=canvas(width,height),rough=canvas(width,height),color=rgb(base);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const u=x/width,v=y/height,tau=Math.PI*2;
    const flow=v*38+.6*Math.sin(u*tau)+.18*Math.sin(u*tau*2+Math.sin(v*tau));
    const bands=Math.sin(flow*tau),fine=Math.sin(flow*tau*4);
    const pore=Math.pow(Math.max(0,Math.sin(flow*tau*2)),18)*(.35+.65*noise(Math.floor(x/12),y));
    const shade=1+bands*.045+fine*.012-pore*.055+(noise(x,y)-.5)*.012;
    const offset=(y*width+x)*4,h=clamp(128+bands*5-pore*16),r=clamp(245+pore*10);
    for(let c=0;c<3;c++){albedo.pixels.data[offset+c]=clamp(color[c]*shade);relief.pixels.data[offset+c]=h;rough.pixels.data[offset+c]=r;}
    albedo.pixels.data[offset+3]=relief.pixels.data[offset+3]=rough.pixels.data[offset+3]=255;
  }
  for(const layer of [albedo,relief,rough])layer.ctx.putImageData(layer.pixels,0,0);
  return {map:map(albedo.image,true,1,4,anisotropy),bump:map(relief.image,false,1,4,anisotropy),roughness:map(rough.image,false,1,4,anisotropy)};
}
