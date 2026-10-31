// Launches the normal product entry with a new, explicitly marked profile.
// It never selects, reads, copies or deletes a production profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const supplied=process.argv.slice(2);
if(supplied.length>1)throw Error('Usage: node scripts/launch-isolated.mjs [PixelStreet.app]');
// On macOS, ignore inherited TMPDIR before creating anything: it might point
// into an actual save tree, where even a subsequently rejected marker is a write.
const temporaryBase=process.platform==='darwin'?'/private/tmp':os.tmpdir();
const profile=fs.realpathSync(fs.mkdtempSync(path.join(temporaryBase,'pixelstreet-isolated-')));
fs.writeFileSync(path.join(profile,'.pixelstreet-isolated-profile.json'),JSON.stringify({product:'PixelStreet',kind:'isolated-playtest',version:1})+'\n',{flag:'wx',mode:0o600});
const env={...process.env,PIXELSTREET_TEST_DATA:profile,PIXELSTREET_REQUIRE_ISOLATION:'1'};
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
for(const key of Object.keys(env))if(/^PIXELSTREET_.*(?:PROFILE|TEST_DATA)/.test(key)&&key!=='PIXELSTREET_TEST_DATA')delete env[key];
const app=supplied[0]&&fs.realpathSync(path.resolve(supplied[0]));
const productName=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).productName;
const executable=app?path.join(app,'Contents/MacOS',productName):path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const args=[...(app?[]:[root]),`--isolated-profile=${profile}`];
console.log(`Independent playtest profile (retained after exit): ${profile}`);
const child=spawn(executable,args,{env,stdio:'inherit',cwd:root});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
