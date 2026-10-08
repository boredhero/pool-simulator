import type {SafeFrame} from './cameraRig';
export interface FrameRect {left:number;right:number;top:number;bottom:number;width:number;height:number}

/** Reserve actual visible HUD bands in canvas coordinates, including offset canvases. */
export function mobileSafeFrame(canvas:FrameRect,above:FrameRect[],below:FrameRect[]):SafeFrame|null{
  const visible=(r:FrameRect)=>r.width>0&&r.height>0&&r.right>canvas.left&&r.left<canvas.right&&r.bottom>canvas.top&&r.top<canvas.bottom;
  const top=Math.max(canvas.top+12,...above.filter(visible).map(r=>r.bottom+12));
  const bottom=Math.min(canvas.bottom-12,...below.filter(visible).map(r=>r.top-12));
  if(bottom-top<80||canvas.width<64)return null;
  return {left:-1+32/canvas.width,right:1-32/canvas.width,
    top:1-2*(top-canvas.top)/canvas.height,bottom:1-2*(bottom-canvas.top)/canvas.height};
}
