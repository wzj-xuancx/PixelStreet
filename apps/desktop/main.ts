import { app } from 'electron';
import { startDesktop } from './bootstrap';
import {configureDataPaths,resolveLaunchProfile} from './launch-profile';
try {
  const folder=resolveLaunchProfile(process.argv,process.env,app.getPath('appData'));
  // The profile and Chromium session must be selected BEFORE the instance lock.
  configureDataPaths(app,app.getPath('appData'),folder);
  if (!app.requestSingleInstanceLock()) app.quit();
  else void startDesktop(folder).then(shell => {
    app.on('second-instance', () => shell.restore());
  }).catch(error => { console.error('Desktop initialization failed:', error.message); app.quit(); });
}catch(error){console.error('Profile isolation rejected:',String(error));app.exit(1);}
