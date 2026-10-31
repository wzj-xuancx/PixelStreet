import test from 'node:test';
import assert from 'node:assert/strict';
import {SecureFrames} from '../packages/room-net/secure-frame';
const pair=()=>({client:new SecureFrames(Buffer.alloc(16,7),'authenticated transcript','client'),host:new SecureFrames(Buffer.alloc(16,7),'authenticated transcript','host')});
test('0190 AEAD hides every payload and rejects tamper, wrong direction, transcript, replay and skipped sequence',()=>{
 const {client,host}=pair(),packet=client.seal({name:'private name',resumeToken:'private credential',chat:'private chat'});
 assert.doesNotMatch(JSON.stringify(packet),/private/);
 for(const key of ['tag','nonce','ciphertext','seq','version']){const p={...packet,[key]:key==='version'?2:key==='seq'?'2':'AAAAAAAAAAAAAAAAAAAAAA'};assert.throws(()=>host.open(p));}
 assert.throws(()=>client.open(packet));
 assert.throws(()=>new SecureFrames(Buffer.alloc(16,7),'wrong transcript','host').open(packet));
 assert.deepEqual(host.open(packet),{name:'private name',resumeToken:'private credential',chat:'private chat'});
 assert.throws(()=>host.open(packet));
 const a=pair();a.client.seal({lost:true});assert.throws(()=>a.host.open(a.client.seal({skip:true})));
 assert.throws(()=>pair().host.open({type:'data',version:3,seq:1,payload:{plaintext:true}}));
});
test('0190 directional keys and per-connection transcripts produce different nonces and ciphertext',()=>{
 const a=pair(),one=a.client.seal({x:1}),two=a.host.seal({x:1});assert.notEqual(one.nonce,two.nonce);assert.notEqual(one.ciphertext,two.ciphertext);
 const other=new SecureFrames(Buffer.alloc(16,7),'fresh dual nonces','client').seal({x:1});assert.notEqual(one.nonce,other.nonce);
});
import * as net from 'node:net';
import {randomBytes} from 'node:crypto';
import {joinRoom,hostRoom} from '../packages/room-net';
test('0190 rejects incompatible version/capability before revealing identity',async(t)=>{
 for(const override of [{version:2,capabilities:'room-aead-v1,party-field-v1'},{version:3,capabilities:'room-aead-v1'}]){
  let bytes=0;const server=net.createServer(socket=>{socket.on('data',b=>bytes+=b.length);const packet=Buffer.from(JSON.stringify({type:'challenge',roomId:randomBytes(16).toString('base64url'),hostId:'a'.repeat(32),serverNonce:randomBytes(16).toString('base64url'),...override})),header=Buffer.alloc(4);header.writeUInt32BE(packet.length);socket.end(Buffer.concat([header,packet]));});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');await assert.rejects(joinRoom({peerId:'b'.repeat(32),name:'do not reveal',address:`127.0.0.1:${address.port}`,key:randomBytes(16).toString('base64url')},{message(){},closed(){}}));assert.equal(bytes,0);await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
});
test('0190 wire carries encrypted names, credentials, chat and cards through actual TCP',async(t)=>{
 const frames:Record<string,unknown>[]=[],sockets=new Set<net.Socket>();let got:Record<string,unknown>|undefined;
 const host=await hostRoom({peerId:'a'.repeat(32),name:'host private',bind:'127.0.0.1'},{peerJoined(){},peerLeft(){},message(_p,p){got=p;},error(){}});t.after(()=>host.close());
 const server=net.createServer(client=>{const upstream=net.createConnection({host:'127.0.0.1',port:Number(host.address.split(':')[1])});sockets.add(client);sockets.add(upstream);for(const [from,to]of [[client,upstream],[upstream,client]]){let buffer=Buffer.alloc(0);from.on('data',chunk=>{to.write(chunk);buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=buffer.readUInt32BE(0)+4){const n=buffer.readUInt32BE(0);frames.push(JSON.parse(buffer.subarray(4,4+n).toString()));buffer=buffer.subarray(4+n);}});from.on('error',()=>{client.destroy();upstream.destroy();});from.on('end',()=>to.end());}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));});const address=server.address();assert.ok(address&&typeof address!=='string');
 const client=await joinRoom({peerId:'b'.repeat(32),name:'client private',address:`127.0.0.1:${address.port}`,key:host.key},{message(){},closed(){}});t.after(()=>client.close());client.send({type:'chat',text:'secret chat payload'});host.send(client.hostId===host.hostId?'b'.repeat(32):'',{type:'item-card',privateCard:'secret card payload'});
 for(let n=0;n<100&&!got;n++)await new Promise(r=>setTimeout(r,5));assert.equal(got?.text,'secret chat payload');await new Promise(r=>setTimeout(r,10));const wire=JSON.stringify(frames);for(const secret of ['client private','secret chat payload','secret card payload',client.resume.token])assert.ok(!wire.includes(secret));assert.ok(frames.every(p=>['challenge','auth','sealed'].includes(p.type as string)));assert.ok(frames.filter(p=>p.type==='sealed').length>=5);
});

test('0190 secure sequence really exceeds JS safe integer and stops at uint64, tags stay exactly16 bytes',()=>{
 const {client,host}=pair();(client as any).sent=9007199254740992n;(host as any).received=9007199254740992n;const packet=client.seal({high:true});assert.equal(packet.seq,'9007199254740993');assert.equal(Buffer.from(packet.tag as string,'base64url').length,16);assert.deepEqual(host.open(packet),{high:true});(client as any).sent=(1n<<64n)-1n;assert.throws(()=>client.seal({exhausted:true}));
});

test('0190 authenticated disconnect reservations remain bounded under identity churn',async(t)=>{
 const host=await hostRoom({peerId:'a'.repeat(32),name:'host',bind:'127.0.0.1'},{peerJoined(){},peerLeft(){},message(){},error(){}});t.after(()=>host.close());
 for(let n=0;n<8;n++){const client=await joinRoom({peerId:(n+100).toString(16).padStart(32,'0'),name:'owned guest',address:host.address,key:host.key},{message(){},closed(){}});await client.close();}
 await assert.rejects(joinRoom({peerId:'d'.repeat(32),name:'churn limit',address:host.address,key:host.key},{message(){},closed(){}}));assert.equal(host.peers.length,0);
});
test('0190 authenticated intentional leave releases identity immediately while stale leave cannot remove its replacement',async(t)=>{
 const reasons:string[]=[];const host=await hostRoom({peerId:'a'.repeat(32),name:'host',bind:'127.0.0.1'},{peerJoined(){},peerLeft(_p,r){reasons.push(r);},message(){},error(){}});t.after(()=>host.close());const options={peerId:'b'.repeat(32),name:'guest',address:host.address,key:host.key};
 const first=await joinRoom(options,{message(){},closed(){}}),old=first.resume;
 await (first as any).leave();assert.equal(host.peers.length,0);assert.deepEqual(reasons,['intentional leave']);
 const replacement=await joinRoom(options,{message(){},closed(){}});t.after(()=>replacement.close());await (first as any).leave();assert.equal(host.peers.length,1);await (replacement as any).leave();
 await assert.rejects(joinRoom({...options,resume:old},{message(){},closed(){}}));
 const fresh=await joinRoom(options,{message(){},closed(){}});await (fresh as any).leave();
});
test('0190 leave waits for Host membership completion and bounds a stalled ACK; host close never waits on callback',async(t)=>{
 let complete:()=>void=()=>{};const host=await hostRoom({peerId:'a'.repeat(32),name:'host',bind:'127.0.0.1'},{peerJoined(){},peerLeft(){return new Promise<void>(r=>{complete=r;});},message(){},error(){}});t.after(()=>host.close());const options={peerId:'b'.repeat(32),name:'guest',address:host.address,key:host.key};
 const c=await joinRoom(options,{message(){},closed(){}});let done=false;const leave=c.leave().then(()=>{done=true;});await new Promise(r=>setTimeout(r,30));assert.equal(done,false);complete();await leave;assert.equal(done,true);
 const blocked=await joinRoom(options,{message(){},closed(){}});const started=Date.now();await assert.rejects(blocked.leave(),/确认未收到/);assert.ok(Date.now()-started<1600);complete();
 const active=await joinRoom({...options,peerId:'c'.repeat(32)},{message(){},closed(){}});await Promise.race([host.close(),new Promise((_r,reject)=>setTimeout(()=>reject(Error('host close blocked by callback')),500))]);await active.close();complete();
});

test('0190 a free-text disconnect reason cannot impersonate authenticated deliberate leave',async(t)=>{let kind='';const h=await hostRoom({peerId:'a'.repeat(32),name:'host',bind:'127.0.0.1'},{peerJoined(){},peerLeft(_p,_r,k){kind=k;},message(){},error(){}});t.after(()=>h.close());const options={peerId:'b'.repeat(32),name:'guest',address:h.address,key:h.key};const c=await joinRoom(options,{message(){},closed(){}});const resume=c.resume;h.disconnect(options.peerId,'intentional leave');for(let n=0;n<50&&!kind;n++)await new Promise(r=>setTimeout(r,5));assert.equal(kind,'disconnected');await assert.rejects(joinRoom(options,{message(){},closed(){}}));const restored=await joinRoom({...options,resume},{message(){},closed(){}});await restored.leave();});
test('0190 finalized transport without a left ACK rejects leave and keeps its failure idempotent',async(t)=>{
 const host=await hostRoom({peerId:'a'.repeat(32),name:'host',bind:'127.0.0.1'},{peerJoined(){},peerLeft(){},message(){},error(){}});t.after(()=>host.close());const options={peerId:'b'.repeat(32),name:'guest',address:host.address,key:host.key};const c=await joinRoom(options,{message(){},closed(){}});await c.close();
 for(let n=0;n<50&&host.peers.length;n++)await new Promise(r=>setTimeout(r,5));assert.equal(host.peers.length,0);
 let failure:unknown;await assert.rejects(c.leave(),e=>{failure=e;return e instanceof Error&&/确认未收到.*30秒/.test(e.message);});await assert.rejects(c.leave(),e=>e===failure);
 await assert.rejects(joinRoom(options,{message(){},closed(){}}));
});
