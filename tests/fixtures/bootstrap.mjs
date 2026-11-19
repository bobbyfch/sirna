// Generate deterministic Node-only fixtures for cloud CI. No Pillow and no
// workstation-specific paths. Browser end-to-end fixtures may use richer assets.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, chunk } from './png-io.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const u32 = (n) => { const b=Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n) => { const b=Buffer.alloc(2); b.writeUInt16LE(n); return b; };

export function ensureMetaFixtures() {
  mkdirSync(here+'/matrix', { recursive: true });
  // EXIF TIFF: IFD0 Make, Model, and GPS pointer; EOI is preserved by edit.
  const make=Buffer.from('Canon\0','ascii'), model=Buffer.from('EOS R50\0','ascii');
  const ifd=Buffer.alloc(2 + 3*12 + 4);
  ifd.writeUInt16LE(3,0);
  const entry=(i, tag, type, count, ptr)=>{
    const o=2+i*12; ifd.writeUInt16LE(tag,o); ifd.writeUInt16LE(type,o+2);
    ifd.writeUInt32LE(count,o+4); ifd.writeUInt32LE(ptr,o+8);
  };
  const start=8+ifd.length;
  entry(0,0x010f,2,make.length,start);
  entry(1,0x0110,2,model.length,start+make.length);
  entry(2,0x8825,4,1,start+make.length+model.length);
  const tiff=Buffer.concat([Buffer.from([0x49,0x49,0x2a,0]),u32(8),ifd,make,model,u16(0),u32(0)]);
  const payload=Buffer.concat([Buffer.from('Exif\0\0'),tiff]);
  const length=Buffer.alloc(2);length.writeUInt16BE(payload.length+2);
  writeFileSync(here+'/jejak-exif.jpg',Buffer.concat([
    Buffer.from([0xff,0xd8,0xff,0xe1]),length,payload,Buffer.from([0xff,0xd9])]));
  const img=gradient(400,300);
  const png=encodePng(img);
  const pngSig=png.subarray(0,8), rest=png.subarray(8);
  // Prepend tEXt before IDAT, then checksum is computed by png-io.
  const ihdrLength=png.readUInt32BE(8);
  const ihdrEnd=8+12+ihdrLength;
  writeFileSync(here+'/matrix/png-text.png',Buffer.concat([
    pngSig,png.subarray(8,ihdrEnd),
    chunk('tEXt',Buffer.from('Software\0OpenAI DALL-E','latin1')),
    chunk('tEXt',Buffer.from('Parameters\0seed 42','latin1')),
    png.subarray(ihdrEnd)]));
}

export function gradient(w,h) {
  const data=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const i=(y*w+x)*4;
    data[i]=Math.floor(x*255/(w-1));
    data[i+1]=Math.floor(y*255/(h-1));
    data[i+2]=128;
    data[i+3]=255;
  }
  return {width:w,height:h,data};
}

export async function ensureWatermarkFixtures() {
  const base=gradient(800,600);
  writeFileSync(here+'/wm-clean.png',encodePng(base));
  const fake={...base,data:Buffer.from(base.data)};
  // Hand-drawn cross, deliberately not the known Gemini alpha pattern.
  for(let y=533;y<557;y++)for(let x=730;x<754;x++) {
    if (Math.abs(x-742)<=1 || Math.abs(y-545)<=1) {
      const i=(y*800+x)*4;
      fake.data[i]=fake.data[i+1]=fake.data[i+2]=255;
    }
  }
  writeFileSync(here+'/wm-test.png',encodePng(fake));
  await import('./gen-sparkle.mjs');
}
