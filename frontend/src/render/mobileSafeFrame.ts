import type {SafeFrame} from './cameraRig';
export interface FrameRect {left:number;right:number;top:number;bottom:number;width:number;height:number}

/** Reserve actual visible HUD bands in canvas coordinates, including offset canvases. */
export function mobileSafeFrame(canvas:FrameRect,above:FrameRect[],below:FrameRect[]):SafeFrame|null{
  const visible=(r:FrameRect)=>r.width>0&&r.height>0&&r.right>canvas.left&&r.left<canvas.right&&r.bottom>canvas.top&&r.top<canvas.bottom;
  const leftPanels=above.filter(visible),rightPanels=below.filter(visible);
  // Landscape touch layouts reserve full-height side panels. Detect their
  // geometry so a narrow desktop window with horizontal HUD bands still works.
  if(canvas.width>canvas.height&&leftPanels.length&&leftPanels.every(r=>r.right<canvas.left+canvas.width*.5)&&rightPanels.every(r=>r.left>canvas.left+canvas.width*.5)){
    const left=Math.max(canvas.left+16,...leftPanels.map(r=>r.right+12));
    const right=Math.min(canvas.right-16,...rightPanels.map(r=>r.left-12));
    if(right-left<80||canvas.height<104)return null;
    return {left:2*(left-canvas.left)/canvas.width-1,right:2*(right-canvas.left)/canvas.width-1,
      top:1-24/canvas.height,bottom:-1+24/canvas.height};
  }
  const top=Math.max(canvas.top+12,...above.filter(visible).map(r=>r.bottom+12));
  const bottom=Math.min(canvas.bottom-12,...below.filter(visible).map(r=>r.top-12));
  if(bottom-top<80||canvas.width<64)return null;
  return {left:-1+32/canvas.width,right:1-32/canvas.width,
    top:1-2*(top-canvas.top)/canvas.height,bottom:1-2*(bottom-canvas.top)/canvas.height};
}
