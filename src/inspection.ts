import { scanTraces, filenameTrace, type Trace } from "./jejak";

/** Inspection is read-only, fully on-device. No network/telemetry calls. */
export interface Inspection {
  name: string;
  size: number;
  mime: string;
  dimensions: { width: number; height: number } | null;
  traces: Trace[];
  aiHints: string[];
  credentials: "embedded" | "possible" | "not-seen";
  credentialEvidence: string;
  limited: boolean;
  risks: string[];
}
export interface Integrity {
  originalSize: number;
  resultSize: number;
  resolution: "same" | "changed" | "unverified" | "not-applicable";
  bytes: "pixel-data-preserved" | "reencoded-or-unknown";
  mimeChange: boolean;
  remaining: number;
}

const HEADER_LIMIT = 12 * 1024 * 1024;
function ascii(b: Uint8Array, off: number, length: number): string {
  return Array.from(b.subarray(off,Math.min(b.length,off+length)))
    .map(x=>x>=32&&x<127?String.fromCharCode(x):" ").join("");
}
function c2paMarker(b: Uint8Array): {status: Inspection["credentials"]; evidence: string} {
  if(b.length >= 4 && b[0]===0xff && b[1]===0xd8) {
    let p=2;
    while(p+4<=b.length) {
      if(b[p]!==0xff) break;
      const marker=b[p+1];
      if(marker===0xda || marker===0xd9) break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7)){p+=2;continue;}
      const len=(b[p+2]<<8)|b[p+3];
      if(len<2||p+2+len>b.length) break;
      if(marker===0xeb) {
        // JPEG C2PA uses JUMBF carried in APP11. A marker alone does not
        // prove a valid credential or verified signature.
        const id=ascii(b,p+4,Math.min(len-2,128)).toLowerCase();
        if(id.includes("c2pa")||id.includes("jumb")||id.includes("jp")) {
          return {status:"possible",evidence:"JPEG APP11 / JUMBF ditemukan; validitas tanda tangan belum diperiksa"};
        }
      }
      p+=2+len;
    }
  }
  if(b.length>=8 && b[0]===0x89 && b[1]===0x50) {
    let p=8;
    while(p+12<=b.length){
      const n=(b[p]*0x1000000)+(b[p+1]<<16)+(b[p+2]<<8)+b[p+3];
      if(n<0||p+12+n>b.length)break;
      const type=ascii(b,p+4,4);
      if(type==="caBX") return {status:"embedded",evidence:"PNG caBX (wadah manifest C2PA) ditemukan; tanda tangan belum divalidasi"};
      if(type==="IEND")break;
      p+=12+n;
    }
  }
  return {status:"not-seen",evidence:"Tidak terlihat manifest tertanam pada bagian format yang dapat diperiksa"};
}

function guessMime(b:Uint8Array, name:string, reported:string):string {
  if(b.length>11 && b[0]===0xff && b[1]===0xd8) return "image/jpeg";
  if(b.length>8 && b[0]===0x89 && b[1]===0x50) return "image/png";
  if(ascii(b,0,4)==="RIFF" && ascii(b,8,4)==="WEBP") return "image/webp";
  if(ascii(b,4,4)==="ftyp") {
    const brand=ascii(b,8,4);
    if(/avif|avis/.test(brand))return "image/avif";
    if(/heic|heix|hevc|hevx|mif1|msf1/.test(brand))return "image/heic";
  }
  if(b.length>4 && (ascii(b,0,4)==="II* " || ascii(b,0,4)==="MM *"))return "image/tiff";
  return reported || (/\.tiff?$/i.test(name)?"image/tiff":/\.hei[cf]$/i.test(name)?"image/heic":"application/octet-stream");
}

async function imageDimensions(blob:Blob,mime:string):Promise<Inspection["dimensions"]>{
  if(!mime.startsWith("image/") || blob.size>90*1024*1024) return null;
  if(typeof createImageBitmap!=="function")return null;
  try {
    const bitmap=await createImageBitmap(blob);
    const result={width:bitmap.width,height:bitmap.height};
    bitmap.close();
    return result;
  }catch {return null;}
}

export async function inspectFile(blob:Blob,name:string):Promise<Inspection>{
  const head=new Uint8Array(await blob.slice(0,HEADER_LIMIT).arrayBuffer());
  const mime=guessMime(head,name,blob.type);
  const limited=blob.size>HEADER_LIMIT;
  const traces = mime.startsWith("image/") ? await scanTraces(
    limited ? blob.slice(0,HEADER_LIMIT,mime) : blob) : [];
  const filename=filenameTrace(name);
  if(filename)traces.push(filename);
  const marker=c2paMarker(head);
  const hints:string[]=[];
  for(const tr of traces){
    if(/pngtext|xmp|iptc|exif|comment/i.test(tr.kind)
       && /openai|dall.?e|gemini|prompt|seed|midjourney|stable diffusion|firefly|flux/i.test(tr.detail))
      hints.push(tr.label);
  }
  const risks:string[]=[];
  if(traces.some(x=>x.kind==="gps"))risks.push("Lokasi GPS");
  if(traces.some(x=>["time","filename"].includes(x.kind)))risks.push("Waktu atau nama file");
  if(traces.some(x=>["exif","xmp","iptc","pngtext","comment"].includes(x.kind)))risks.push("Informasi pembuatan");
  if(marker.status!=="not-seen") risks.push("Content Credentials");
  return {name,size:blob.size,mime,dimensions:await imageDimensions(blob,mime),
    traces,aiHints:[...new Set(hints)],credentials:marker.status,
    credentialEvidence:marker.evidence,limited,risks};
}
export function integrityOf(original:Inspection,result:Inspection,lossless:boolean):Integrity{
  const resolution = !original.mime.startsWith("image/") ? "not-applicable" :
    !original.dimensions||!result.dimensions ? "unverified" :
      original.dimensions.width===result.dimensions.width &&
      original.dimensions.height===result.dimensions.height ? "same" : "changed";
  return {originalSize:original.size,resultSize:result.size,resolution,
    bytes:lossless?"pixel-data-preserved":"reencoded-or-unknown",
    mimeChange:original.mime!==result.mime,
    remaining:result.traces.filter(x=>x.kind!=="filename").length};
}
