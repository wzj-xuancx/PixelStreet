import { nativeImage, type NativeImage } from 'electron';
import { deflateSync } from 'node:zlib';
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) { c ^= byte; for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}
export function trayImage(): NativeImage {
  const size = 22, raw = Buffer.alloc((size * 4 + 1) * size);
  const pixel = (x: number, y: number) => { raw[y * (size * 4 + 1) + 1 + x * 4 + 3] = 255; };
  for (let y = 4; y <= 8; y++) for (let x = 3; x <= 18; x++) if (y === 4 || y === 8 || x % 3 === 0) pixel(x, y);
  for (let y = 9; y <= 18; y++) for (let x = 4; x <= 17; x++) if (x === 4 || x === 17 || y === 18 || (x >= 8 && x <= 12 && (y === 11 || x === 8 || x === 12))) pixel(x, y);
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const image = nativeImage.createFromBuffer(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}
