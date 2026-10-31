import type {Recipe} from './catalog';
export interface GameplayFeedback {
 readonly id:number;readonly tick:number;readonly runId:string|null;readonly wave:number;
 readonly kind:'depart'|'attack'|'hurt'|'frost'|'shatter'|'win'|'return'|'sale';readonly amount:number;readonly recipe?:Recipe;
}
export type GameplayEvent=Omit<GameplayFeedback,'id'>;
export type GameplayObserver=(event:GameplayEvent)=>void;
export interface FeedbackFeed {epoch:string;cursor:number;events:GameplayFeedback[]}
export const createFeedbackFeed=(epoch:string):FeedbackFeed=>({epoch,cursor:0,events:[]});
/** Runtime owner supplies a fresh epoch on import; neither feed nor cursor belongs in Profile. */
export function appendFeedback(feed:FeedbackFeed,events:readonly GameplayEvent[]):void {
 for(const event of events)feed.events.push(Object.freeze({...event,id:++feed.cursor}));
 if(feed.events.length>32)feed.events.splice(0,feed.events.length-32);
}
/** Buffer at most32 events until the entire authoritative operation validates successfully. */
export function pendingFeedback():{observe:GameplayObserver;publish:(observer?:GameplayObserver)=>void} {
 const events:GameplayEvent[]=[];
 return {observe:event=>{events.push(Object.freeze({...event}));if(events.length>32)events.shift();},publish:observer=>{if(observer)for(const event of events){try{observer(event);}catch{/* Presentation observers never change authoritative success. */}}}};
}
