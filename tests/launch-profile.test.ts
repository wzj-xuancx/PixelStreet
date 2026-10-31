import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertIsolatedFolder,configureDataPaths,markIsolatedFolder,resolveLaunchProfile} from '../apps/desktop/launch-profile';

test('isolated launch fails closed before any default profile access',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pixelstreet-launch-')));
 const appData=path.join(root,'never-opened-app-data'),profile=path.join(root,'owned-profile');fs.mkdirSync(profile);
 assert.equal(resolveLaunchProfile([],{},appData),undefined);
 assert.throws(()=>resolveLaunchProfile(['--isolated-profile='],{},appData));
 assert.throws(()=>resolveLaunchProfile([],{PIXELSTREET_TEST_DATA:''},appData));
 assert.throws(()=>resolveLaunchProfile(['--isolated-profile='],{PIXELSTREET_TEST_DATA:''},appData));
 assert.throws(()=>resolveLaunchProfile(['--isolated-profile'],{},appData));
 assert.throws(()=>resolveLaunchProfile(['--isolated-profile=/a','--isolated-profile=/b'],{},appData));
 assert.throws(()=>resolveLaunchProfile([], {PIXELSTREET_REQUIRE_ISOLATION:'1'},appData));
 for(const value of ['true','false','0',''])assert.throws(()=>resolveLaunchProfile([], {PIXELSTREET_REQUIRE_ISOLATION:value},appData));
 assert.throws(()=>resolveLaunchProfile([], {PIXELSTREET_PATHS_PROFILE:profile},appData));
 assert.throws(()=>resolveLaunchProfile([`--isolated-profile=${profile}`],{},appData));
 assert.equal(fs.existsSync(appData),false);
 markIsolatedFolder(profile,appData);
 assert.equal(resolveLaunchProfile([`--isolated-profile=${profile}`],{PIXELSTREET_TEST_DATA:profile,PIXELSTREET_REQUIRE_ISOLATION:'1'},appData),profile);
 assert.throws(()=>resolveLaunchProfile([`--isolated-profile=${profile}`],{PIXELSTREET_TEST_DATA:root},appData));
 assert.throws(()=>resolveLaunchProfile(['--isolated-profile=relative'],{},appData));
 assert.throws(()=>assertIsolatedFolder(path.join(appData,'PixelStreetSolo'),appData));
 const link=path.join(root,'linked');fs.symlinkSync(profile,link);assert.throws(()=>assertIsolatedFolder(link,appData));
 const paths:Record<string,string>={};configureDataPaths({setName:()=>{},setPath:(key,value)=>{paths[key]=value;}},appData,profile);
 assert.deepEqual(paths,{userData:profile,sessionData:path.join(profile,'session')});
 assert.equal(fs.existsSync(appData),false);
 fs.rmSync(root,{recursive:true,force:true}); // Only this test's unique owned temporary directory.
});
