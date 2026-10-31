import { contextBridge, ipcRenderer } from 'electron';
// This file is bundled; sandbox preload does not import arbitrary local modules at runtime.
import { channels, type Command, type Settings, type ShellState, type StreetAPI } from '../../packages/protocol';
import type {DungeonInput} from '../../packages/dungeon-core';
const api: StreetAPI = Object.freeze({
  previewInventory: (generation:number,request:Parameters<StreetAPI['previewInventory']>[1]) => ipcRenderer.invoke(channels.inventoryPreview,generation,request),
  state: () => ipcRenderer.invoke(channels.state),
  command: (command: Command) => ipcRenderer.invoke(channels.command, command),
  dungeonControl: (input:Extract<DungeonInput,{type:'control'|'cancel-controls'}>) => ipcRenderer.send(channels.dungeonControl,input),
  saveSettings: (settings: Settings, generation: number) => ipcRenderer.invoke(channels.save, settings, generation),
  exportSettings: (generation: number) => ipcRenderer.invoke(channels.export, generation),
  importSettings: (text: string, generation: number) => ipcRenderer.invoke(channels.import, text, generation),
  previewGameImport: (generation:number) => ipcRenderer.invoke(channels.gameImportPreview,generation),
  confirmGameImport: (token:string,generation:number) => ipcRenderer.invoke(channels.gameImportConfirm,token,generation),
  subscribe: (callback: (state: ShellState) => void) => {
    const listener = (_event: unknown, state: ShellState) => callback(state);
    ipcRenderer.on(channels.update, listener);
    return () => ipcRenderer.removeListener(channels.update, listener);
  },
});
contextBridge.exposeInMainWorld('street', api);
