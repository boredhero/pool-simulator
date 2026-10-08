import { CanvasTexture, SRGBColorSpace, RepeatWrapping } from 'three';

export const CUE_STYLES=['plain','red-spots','red-ring','blue-dot','black-triangles'] as const;
export type CueStyle=typeof CUE_STYLES[number];
export const cueStyle=(value:string|null):CueStyle=>CUE_STYLES.includes(value as CueStyle)?value as CueStyle:'plain';
const WHITE=[247,244,233],INK=[20,20,19];
const COLORS=['#e5b522','#163caa','#bd202e','#592679','#e7681a','#17654a','#70242d','#141619'];
const SIZE=1024,HEIGHT=512;
const cosine=Float64Array.from({length:SIZE},(_,x)=>Math.cos(2*Math.PI*(x+.5)/SIZE));
const sine=Float64Array.from({length:SIZE},(_,x)=>Math.sin(2*Math.PI*(x+.5)/SIZE));
const clamp=(x:number)=>Math.max(0,Math.min(1,x));

/** Inlaid markings on a sphere, not flat UV circles or baked-in lighting. */
export function ballTexture(n:number|null,style:CueStyle='plain',anisotropy=1):CanvasTexture {
  const canvas=document.createElement('canvas');canvas.width=SIZE;canvas.height=HEIGHT;
  const context=canvas.getContext('2d')!,image=context.createImageData(SIZE,HEIGHT),pixels=image.data;
  const color=n===null?WHITE:COLORS[(n-1)%8].slice(1).match(/../g)!.map(c=>parseInt(c,16));
  let glyph:Uint8ClampedArray|undefined;
  if(n!==null) {
    const label=document.createElement('canvas');label.width=label.height=256;
    const g=label.getContext('2d')!;g.fillStyle='#000';g.font='700 154px Arial, sans-serif';g.textAlign='center';g.textBaseline='middle';
    g.fillText(String(n),128,132,202);
    if(n===6||n===9)g.fillRect(94,207,68,7);
    glyph=g.getImageData(0,0,256,256).data;
  }
  const badgeCos=Math.cos(.42),badgeScale=Math.tan(.42);
  for(let y=0;y<HEIGHT;y++) {
    const latitude=Math.PI*(.5-(y+.5)/HEIGHT),dy=Math.sin(latitude),ring=Math.cos(latitude);
    for(let x=0;x<SIZE;x++) {
      const dx=cosine[x]*ring,dz=sine[x]*ring,az=Math.abs(dz),offset=4*(y*SIZE+x);
      let r:number,g:number,b:number;
      if(n===null) {[r,g,b]=WHITE;
        let amount=0,mark=INK;
        if(style==='red-spots'){amount=clamp((Math.max(Math.abs(dx),Math.abs(dy),az)-Math.cos(.11))/.0007+.5);mark=[181,31,39];}
        if(style==='blue-dot'){amount=clamp((dz-Math.cos(.075))/.0005+.5);mark=[30,67,153];}
        if(style==='red-ring'){amount=clamp((dz-Math.cos(.13))/.0006+.5)*clamp((Math.cos(.09)-dz)/.0006+.5);mark=[181,31,39];}
        if(style==='black-triangles') {
          const axis=Math.max(Math.abs(dx),Math.abs(dy),az);
          if(axis>Math.cos(.15)) {
            const u=(axis===Math.abs(dx)?dz:dx)/axis/.12;
            const v=(axis===Math.abs(dy)?dz:dy)/axis/.12;
            amount=clamp(Math.min(v+.55,.85-v-1.7*Math.abs(u))/.055+.5);
          }
        }
        r+=(mark[0]-r)*amount;g+=(mark[1]-g)*amount;b+=(mark[2]-b)*amount;
      } else {
        const band=n>8?clamp((.53-Math.abs(dy))/.005+.5):1;
        r=WHITE[0]+(color[0]-WHITE[0])*band;g=WHITE[1]+(color[1]-WHITE[1])*band;b=WHITE[2]+(color[2]-WHITE[2])*band;
        const badge=clamp((az-badgeCos)/.002+.5);
        r+=(WHITE[0]-r)*badge;g+=(WHITE[1]-g)*badge;b+=(WHITE[2]-b)*badge;
        if(badge>0) {
          const px=Math.floor((.5-Math.sign(dz)*dx/(2*az*badgeScale))*256);
          const py=Math.floor((.5-dy/(2*az*badgeScale))*256);
          if(px>=0&&px<256&&py>=0&&py<256) {
            const ink=glyph![4*(py*256+px)+3]/255*badge;
            r+=(INK[0]-r)*ink;g+=(INK[1]-g)*ink;b+=(INK[2]-b)*ink;
          }
        }
      }
      pixels[offset]=r;pixels[offset+1]=g;pixels[offset+2]=b;pixels[offset+3]=255;
    }
  }
  context.putImageData(image,0,0);
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.wrapS=RepeatWrapping;texture.anisotropy=anisotropy;
  return texture;
}
