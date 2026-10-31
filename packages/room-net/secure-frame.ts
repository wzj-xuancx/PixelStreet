import {createCipheriv,createDecipheriv,hkdfSync,createHash,timingSafeEqual} from 'node:crypto';
export const ROOM_PROTOCOL_VERSION=3;
export const ROOM_CAPABILITIES='room-aead-v1,party-field-v1';
type RecordValue=Record<string,unknown>;
const MAX_SEQUENCE=(1n<<64n)-1n;
const strictUtf8=new TextDecoder('utf-8',{fatal:true});
function bytes(value:unknown,length?:number):Buffer{
 if(typeof value!=='string'||!value||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('invalid secure frame');
 const b=Buffer.from(value,'base64url');if(b.toString('base64url')!==value||(length!==undefined&&b.length!==length))throw Error('invalid secure frame');return b;
}
/** Main-only AEAD stream. A failed packet never advances receive state or reaches JSON dispatch. */
export class SecureFrames{
 private sent=0n;private received=0n;
 private readonly c2h:Buffer;private readonly h2c:Buffer;private readonly context:string;
 constructor(key:Buffer,transcript:string,private role:'client'|'host'){
  this.context=transcript;
  const salt=createHash('sha256').update(transcript).digest();
  this.c2h=Buffer.from(hkdfSync('sha256',key,salt,'pixelstreet/room/v3/client-to-host',36));
  this.h2c=Buffer.from(hkdfSync('sha256',key,salt,'pixelstreet/room/v3/host-to-client',36));
 }
 private aad(direction:string,seq:string,nonce:string):Buffer{return Buffer.from(JSON.stringify({protocol:ROOM_PROTOCOL_VERSION,context:this.context,direction,seq,nonce}));}
 seal(payload:RecordValue):RecordValue{
  if(this.sent===MAX_SEQUENCE)throw Error('secure sequence exhausted');
  const seq=this.sent+1n,material=this.role==='client'?this.c2h:this.h2c,nonce=Buffer.alloc(12);material.copy(nonce,0,32,36);nonce.writeBigUInt64BE(seq,4);
  const plain=Buffer.from(JSON.stringify(payload));if(!plain.length||plain.length>256*1024)throw Error('secure payload too large');
  const cipher=createCipheriv('aes-256-gcm',material.subarray(0,32),nonce,{authTagLength:16});const seqText=seq.toString(),nonceText=nonce.toString('base64url');
  cipher.setAAD(this.aad(this.role==='client'?'client-to-host':'host-to-client',seqText,nonceText));
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);this.sent=seq;
  return {type:'sealed',version:ROOM_PROTOCOL_VERSION,seq:seqText,nonce:nonceText,ciphertext:ciphertext.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
 }
 open(packet:RecordValue):RecordValue{
  if(Object.keys(packet).sort().join(',')!=='ciphertext,nonce,seq,tag,type,version'||packet.type!=='sealed'||packet.version!==ROOM_PROTOCOL_VERSION||typeof packet.seq!=='string'||!/^[1-9][0-9]{0,19}$/.test(packet.seq))throw Error('invalid secure frame');
  const seq=BigInt(packet.seq);if(seq>MAX_SEQUENCE||seq!==this.received+1n)throw Error('invalid sequence');
  const material=this.role==='host'?this.c2h:this.h2c,nonce=bytes(packet.nonce,12),expected=Buffer.alloc(12);material.copy(expected,0,32,36);expected.writeBigUInt64BE(seq,4);
  if(!timingSafeEqual(nonce,expected))throw Error('invalid secure nonce');
  const ciphertext=bytes(packet.ciphertext);if(ciphertext.length>256*1024)throw Error('secure payload too large');
  const decipher=createDecipheriv('aes-256-gcm',material.subarray(0,32),nonce,{authTagLength:16});decipher.setAuthTag(bytes(packet.tag,16));decipher.setAAD(this.aad(this.role==='host'?'client-to-host':'host-to-client',packet.seq,packet.nonce as string));
  const plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]);const value:unknown=JSON.parse(strictUtf8.decode(plain));
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid secure payload');
  this.received=seq;return value as RecordValue;
 }
}
