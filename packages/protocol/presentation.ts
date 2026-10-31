export type PresentationOwner='overlay'|'popup'|'tower';
export interface NativePresentationState {readonly shown:boolean;readonly focused:boolean}
export type NativePresentations=Readonly<Record<PresentationOwner,NativePresentationState>>;
export const emptyPresentations=():NativePresentations=>({overlay:{shown:false,focused:false},popup:{shown:false,focused:false},tower:{shown:false,focused:false}});
export function presentationActive(p:NativePresentationState|undefined,options:{pointer:boolean;documentVisible:boolean;blocked:boolean}):boolean {
 return !!p?.shown&&options.documentVisible&&!options.blocked&&(p.focused||options.pointer);
}
