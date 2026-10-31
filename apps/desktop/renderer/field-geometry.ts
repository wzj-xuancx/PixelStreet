/** One DIP/world transform for every field sprite, effect, marker and hit. */
export interface FieldTransform {scale:number;x:number;y:number;width:number;height:number}
export function fieldTransform(width:number,height:number,camera:number):FieldTransform {
 const scale=Math.max(.5,Math.min(2,(height-8)/80));return {scale,x:24-camera*scale,y:height-6*scale,width,height};
}
export const fieldWorldAt=(t:FieldTransform,x:number,y:number)=>({x:(x-t.x)/t.scale,y:(y-t.y)/t.scale});
export const fieldScreenAt=(t:FieldTransform,x:number,y=0)=>({x:t.x+x*t.scale,y:t.y+y*t.scale});
export const fieldVisible=(x:number,revealed:number)=>x<=revealed;
