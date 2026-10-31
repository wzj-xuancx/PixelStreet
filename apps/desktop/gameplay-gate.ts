/** Serialize cross-worker checks and commits; rejection does not poison the queue. */
export class GameplayGate {
 private tail:Promise<unknown>=Promise.resolve();
 run<T>(operation:()=>Promise<T>):Promise<T>{const result=this.tail.then(operation);this.tail=result.catch(()=>undefined);return result;}
}
