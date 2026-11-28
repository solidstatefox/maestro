/** Frame bounds are SVG user-space coordinates. Scale changes the CSS size,
 * not the provider's geometry or the aspect ratio of its painted content. */
export type FrameBounds = {left:number;top:number;right:number;bottom:number};
export type FrameDimensions = FrameBounds & {scale?:number};
export type FrameEdge = keyof FrameBounds;
export type FrameHandle = FrameEdge | "corner";
export const FRAME_EDGES: FrameEdge[] = ["left","top","right","bottom"];
export const frameScale = (frame:FrameDimensions|null) => frame?.scale ?? 1;
const clampScale = (scale:number) => Math.max(0.05,Math.min(20,scale));
export function readFrameBounds(raw:string|null):FrameDimensions|null {
  if(!raw)return null;
  try {
    const value=JSON.parse(raw) as FrameDimensions;
    if(!value || !FRAME_EDGES.every(edge=>typeof value[edge]==="number" && Number.isFinite(value[edge]) && Math.abs(value[edge])<=100000))return null;
    if(value.scale!==undefined && (!Number.isFinite(value.scale) || value.scale<0.05 || value.scale>20))return null;
    return value.right>value.left && value.bottom>value.top ? {left:value.left,top:value.top,right:value.right,bottom:value.bottom,...(value.scale===undefined?{}:{scale:value.scale})}:null;
  } catch {return null;}
}
export function includePaint(frame:FrameDimensions|null,paint:FrameBounds):FrameDimensions {
  return frame ? {...frame,left:Math.min(frame.left,paint.left),top:Math.min(frame.top,paint.top),right:Math.max(frame.right,paint.right),bottom:Math.max(frame.bottom,paint.bottom)} : {...paint};
}
export function resizeFrameEdge(frame:FrameDimensions,paint:FrameBounds,edge:FrameEdge,delta:number):FrameDimensions {
  if(!Number.isFinite(delta) || delta===0)return frame;
  const base=includePaint(frame,paint);
  const scale=frameScale(base);
  const negative=edge==="left" || edge==="top";
  const direction=negative?-1:1;
  const opposite:FrameEdge={left:"right",right:"left",top:"bottom",bottom:"top"}[edge] as FrameEdge;
  const slack=Math.max(0,(base[edge]-paint[edge])*direction);
  const movement=delta*direction/scale;
  // While the edge has whitespace, dragging changes only that coordinate.
  // At contact (within one unscaled SVG unit), both directions zoom uniformly.
  const touching=slack<=1;
  if(!touching && slack+movement>=0) {
    const value=Math.max(-100000,Math.min(100000,base[edge]+delta/scale));
    return {...base,[edge]:value};
  }
  // Consume whitespace first; use the remaining drag distance to change the
  // fitted span. Other edges retain their relation to the same SVG geometry.
  const tight={...base,[edge]:paint[edge]};
  const span=Math.abs(tight[opposite]-tight[edge]);
  if(span<=0)return base;
  const remainder=slack+movement;
  return {...tight,scale:clampScale(scale*(1+remainder/span))};
}
/** The diagonal uses the dominant fractional motion, as the original handle did. */
export function resizeFrameCorner(frame:FrameDimensions,dx:number,dy:number):FrameDimensions {
  if(!Number.isFinite(dx) || !Number.isFinite(dy))return frame;
  const scale=frameScale(frame);
  const x=dx/((frame.right-frame.left)*scale),y=dy/((frame.bottom-frame.top)*scale);
  return {...frame,scale:clampScale(scale*(1+(Math.abs(x)>=Math.abs(y)?x:y)))};
}
export function sameFrame(a:FrameDimensions|null,b:FrameDimensions|null,tolerance=0):boolean {
  return a===b || !!a && !!b && frameScale(a)===frameScale(b) && FRAME_EDGES.every(edge=>Math.abs(a[edge]-b[edge])<=tolerance);
}
