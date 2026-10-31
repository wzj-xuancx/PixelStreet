import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { app } from 'electron';
import type { CreateFieldWorldOptions, FieldEffect, FieldWorld, FieldConfirmation } from '../../packages/field-world';
import type { PartyInput } from '../../packages/protocol/party-field';
/** Host-only 100ms authority. No profile, wallet, files or renderer import inside its Worker. */
export class PartyFieldRuntime {
    private worker: Worker;
    world: FieldWorld | null = null;
    private disposed = false;
    constructor(private update: (world: FieldWorld) => void, private effects: (effects: FieldEffect[]) => void, private error: (message: string) => void) { const file = app.isPackaged ? path.join(process.resourcesPath, 'party-field-worker.cjs') : path.join(__dirname, 'party-field-worker.cjs'); this.worker = new Worker(file); this.worker.on('message', m => { if (this.disposed)
        return; if (m.type === 'snapshot') {
        this.world = m.world;
        this.update(m.world);
    }
    else if (m.type === 'effects')
        this.effects(m.effects);
    else if (m.type === 'error')
        this.error(m.error); }); this.worker.on('error', e => this.error(String(e))); this.worker.on('exit', code => { if (!this.disposed)
        this.error('共斗进程退出 ' + code); }); }
    start(options: CreateFieldWorldOptions): void { this.worker.postMessage({ type: 'start', options }); }
    input(actorId: string, hostId: string, intent: PartyInput): void { this.worker.postMessage({ type: 'input', actorId, hostId, intent }); }
    confirm(confirmations: FieldConfirmation[]): void { this.worker.postMessage({ type: 'confirm', confirmations }); }
    presence(actorId: string, online: boolean): void { this.worker.postMessage({ type: 'presence', actorId, online }); }
    retire(actorId: string): void { this.worker.postMessage({ type: 'retire', actorId }); }
    presentation(active: boolean): void { this.worker.postMessage({ type: 'presentation', active }); }
    freeze(frozen: boolean): void { this.worker.postMessage({ type: 'freeze', frozen }); }
    stop(): void { this.world = null; this.worker.postMessage({ type: 'stop' }); }
    async close(): Promise<void> { if (this.disposed)
        return; this.disposed = true; await this.worker.terminate(); }
    dispose(): void { if (this.disposed)
        return; this.disposed = true; void this.worker.terminate(); }
}
