/** Native admission facts only; no profile or reward data crosses this helper. */
export function assertFieldAccess(a:{accepted:boolean;epoch:number;visible:boolean;hidden:boolean;interaction:boolean;workingElsewhere:boolean},epoch:number):void {
 if(!a.accepted||a.epoch!==epoch||!a.visible||a.hidden||!a.interaction||a.workingElsewhere)throw Error('底部冒险已暂收或操作已过期，请回到营地重试。');
}
