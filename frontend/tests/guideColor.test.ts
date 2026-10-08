import { expect, test } from 'vitest';
import { Color } from 'three';
import { guideColor } from '../src/render/guideColor';
const luminance=(c:Color)=>.2126*c.r+.7152*c.g+.0722*c.b;
test('guides contrast with dark, pastel, and neutral cloth and retain a tint',()=>{
  for(const felt of ['#6a1b9a','#0a6c2f','#0d47a1','#b71c1c','#f4e4f8','#ffffff','#000000','#888888']){
    const a=luminance(new Color(felt)),b=luminance(guideColor(felt));
    expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThan(3);
    if(a>.22)expect(b).toBeLessThan(a);else expect(b).toBeGreaterThan(a);
  }
  const purple=guideColor('#6a1b9a');expect(purple.b).toBeGreaterThan(purple.g);
});
