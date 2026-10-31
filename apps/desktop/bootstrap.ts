import { app, Menu, powerMonitor } from 'electron';
import path from 'node:path';
import {APP_NAME} from './identity';
import { DesktopShell } from './shell';
import {configureDataPaths,markIsolatedFolder} from './launch-profile';
export async function startDesktop(testFolder?: string,testMode=false): Promise<DesktopShell> {
  if(testFolder)markIsolatedFolder(testFolder,app.getPath('appData'));
  configureDataPaths(app,app.getPath('appData'),testFolder);
  await app.whenReady();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  const shell = new DesktopShell(app.getPath('userData'),path.join(app.getPath('userData'),'solo'),testMode);
  powerMonitor.on('suspend', () => shell.hide());
  app.on('activate', () => { if (shell.mode === 'hidden') shell.restore(); });
  installDesktopQuit(shell);
  app.on('window-all-closed', () => { /* Tray is the persistent recovery route. */ });
  await shell.load();
  return shell;
}

/** Shared orderly quit boundary, also exercised by the owned native fixture. */
export function installDesktopQuit(shell:DesktopShell):void{
  let flushed=false,closing=false;app.on('before-quit',event=>{if(flushed){shell.dispose();return;}event.preventDefault();if(closing)return;closing=true;shell.beginClose();void shell.partyField.close().catch(()=>{}).then(()=>shell.room.close().catch(()=>{})).then(()=>Promise.allSettled([shell.action.close(),shell.dungeon.close(),shell.game.close()])).finally(()=>{flushed=true;shell.dispose();app.quit();});});
}
