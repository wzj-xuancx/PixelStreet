import frames from '../../../assets/mastery-0160/frames.json';
import {isDisplayBadge,isMasteryId,MASTERY_GOALS,type DisplayBadge,type MasteryId} from '../../../packages/solo-core/mastery';
const cache=new Map<MasteryId,string>();
/** Fixed catalog frames only; no profile-controlled paths, CSS or markup. */
export function masteryArt(id:MasteryId):string{let markup=cache.get(id);if(markup)return markup;const f=frames.frames.find(f=>f.id===id);if(!f)return '';const [x,y,r,b]=f.bounds;markup=`<svg class="mastery-medal" viewBox="${x} ${y} ${r-x} ${b-y}" aria-hidden="true"><svg x="${x}" y="${y}" width="${r-x}" height="${b-y}" viewBox="${x} ${y} ${r-x} ${b-y}" overflow="hidden"><image href="assets/mastery-0160/medal-sheet.webp" width="1536" height="1024"/></svg></svg>`;cache.set(id,markup);return markup;}

/** Fixed local catalog only. Even runtime-invalid peer values cannot become a URL. */
export function masterySmallArt(id:DisplayBadge,size:20|24|32|48):string{if(id==='field:crystal-guardian')return `<img class="mastery-small" src="assets/adventure-0190/candidate-badge.png" width="${size}" height="${size}" alt="" aria-hidden="true">`;return isMasteryId(id)?`<img class="mastery-small" src="assets/chapter-0170/badge-small-${id}.svg" width="${size}" height="${size}" alt="" aria-hidden="true" draggable="false">`:'';}
export function masteryBadgeText(id:DisplayBadge):string{if(id==='field:crystal-guardian')return '裂晶守卫徽记：击败裂晶洞口的盾甲守卫';return isMasteryId(id)?`${MASTERY_GOALS[id].name}：${MASTERY_GOALS[id].detail}`:'';}
export function masteryBadge(id:DisplayBadge|null|undefined,size:20|24|32|48,focusable=true):string{if(!isDisplayBadge(id))return '';const label=masteryBadgeText(id);return `<span class="mastery-badge" role="img" data-badge="${id}" data-tooltip="${label}" aria-label="${label}"${focusable?' tabindex="0"':''}>${masterySmallArt(id,size)}</span>`;}
