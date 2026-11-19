import { inspectFile } from "./inspection";
self.onmessage=async(event:MessageEvent<{id:number,blob:Blob,name:string}>)=>{
  const {id,blob,name}=event.data;
  try { const inspection=await inspectFile(blob,name);self.postMessage({id,inspection});}
  catch(e){self.postMessage({id,error:String((e as Error)?.message||e)});}
};