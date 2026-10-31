import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {APP_NAME,PROFILE_NAME} from './identity';

export const ISOLATION_MARKER='.pixelstreet-isolated-profile.json';
const markerText=JSON.stringify({product:'PixelStreet',kind:'isolated-playtest',version:1})+'\n';
const inside=(candidate:string,root:string)=>candidate===root||candidate.startsWith(root+path.sep);

/** No default profile is opened or inspected by this validation. */
export function assertIsolatedFolder(folder:string,appData:string,requireMarker=true):string {
 if(!path.isAbsolute(folder)||path.resolve(folder)!==folder)throw Error('隔离目录必须是规范绝对路径');
 const protectedRoots=[appData,path.join(appData,'PixelStreetS1'),path.join(appData,'PixelStreetSolo'),os.homedir()];
 if(folder===os.homedir()||protectedRoots.slice(0,1).some(root=>folder===root)||protectedRoots.slice(1,3).some(root=>inside(folder,root)))throw Error('隔离目录不能指向真实设置或进度');
 if(!fs.lstatSync(folder).isDirectory()||fs.realpathSync(folder)!==folder)throw Error('隔离目录必须已存在且不能经过符号链接');
 const marker=path.join(folder,ISOLATION_MARKER);
 if(fs.existsSync(marker)){
  if(!fs.lstatSync(marker).isFile()||fs.lstatSync(marker).isSymbolicLink()||fs.readFileSync(marker,'utf8')!==markerText)throw Error('隔离目录标记不匹配');
 }else if(requireMarker)throw Error('隔离目录缺少独立测试标记，已停止启动');
 return folder;
}

export function markIsolatedFolder(folder:string,appData:string):string {
 assertIsolatedFolder(folder,appData,false);
 const marker=path.join(folder,ISOLATION_MARKER);
 if(!fs.existsSync(marker))fs.writeFileSync(marker,markerText,{flag:'wx',mode:0o600});
 return assertIsolatedFolder(folder,appData,true);
}

export function resolveLaunchProfile(argv:string[],env:NodeJS.ProcessEnv,appData:string):string|undefined {
 const flags=argv.filter(value=>value.startsWith('--isolated-profile'));
 if(flags.length>1||flags.some(value=>!value.startsWith('--isolated-profile=')))throw Error('隔离启动参数无效或重复');
 const cli=flags[0]?.slice('--isolated-profile='.length),variable=env.PIXELSTREET_TEST_DATA;
 if(cli!==undefined&&variable!==undefined&&cli!==variable)throw Error('隔离启动目录不一致');
 const chosen=cli??variable;
 if(chosen!==undefined&&!chosen)throw Error('隔离启动目录不能为空');
 const otherProfileVariable=Object.keys(env).some(key=>/^PIXELSTREET_.*(?:PROFILE|TEST_DATA)/.test(key)&&key!=='PIXELSTREET_TEST_DATA');
 // Presence itself is the guard: a misspelled boolean must never fall back to a real profile.
 if(!chosen&&(env.PIXELSTREET_REQUIRE_ISOLATION!==undefined||otherProfileVariable))throw Error('请求了隔离测试，但未提供有效隔离目录');
 return chosen===undefined?undefined:assertIsolatedFolder(chosen,appData,true);
}

export function configureDataPaths(app:{setName(name:string):void;setPath(name:'userData'|'sessionData',value:string):void},appData:string,folder?:string):void {
 if(folder)assertIsolatedFolder(folder,appData,true);
 const userData=folder??path.join(appData,PROFILE_NAME);
 const sessionData=path.join(userData,'session');
 fs.mkdirSync(sessionData,{recursive:true});
 if(fs.realpathSync(sessionData)!==sessionData)throw Error('会话目录不能经过符号链接');
 app.setName(APP_NAME);app.setPath('userData',userData);app.setPath('sessionData',sessionData);
}
