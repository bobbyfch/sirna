// Manual cross-device QA: npm run build && npm run test:responsive
// Requires Playwright Chromium installed; not part of Cloudflare Workers build.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const url = 'http://127.0.0.1:4179/';
const server = spawn('npm',['run','preview','--','--host','127.0.0.1','--port','4179'],{stdio:'ignore'});
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors=[];
try {
  for(let i=0;i<35;i++){
    try { if((await fetch(url)).ok) break; } catch {}
    await new Promise(r=>setTimeout(r,250));
  }
  for(const width of [320,360,390,600,768,1024,1280,1920]){
    const page = await browser.newPage({viewport:{width,height:800},acceptDownloads:true});
    page.on('pageerror',e=>errors.push(width+': '+e.message));
    await page.goto(url,{waitUntil:'networkidle'});
    await page.click('#sampleBtn');
    await page.locator('#primaryBtn').waitFor({state:'visible',timeout:30000});
    await page.waitForFunction(()=>!document.querySelector('#primaryBtn').disabled);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    if(overflow)throw Error('Horizontal overflow @'+width);
    const dock=await page.locator('#saveDock').boundingBox();
    if(!dock || dock.x<0 || dock.x+dock.width>width+1)throw Error('Download out of viewport @'+width);
    const theme=await page.locator('html').getAttribute('class');
    await page.click('#editorThemeBtn');
    if((await page.locator('html').getAttribute('class'))===theme)throw Error('Editor theme not switching @'+width);
    await page.locator('#advancedSettings summary').click();
    await page.locator('[data-format="image/webp"]').click();
    await page.waitForFunction(()=>document.querySelector('#primaryBtn')?.textContent?.trim()==='Terapkan perubahan');
    await page.locator('#primaryBtn').click();
    await page.waitForFunction(()=>document.querySelector('#primaryBtn')?.textContent?.trim()==='Unduh hasil' && !document.querySelector('#primaryBtn')?.disabled,null,{timeout:30000});
    const dlPromise=page.waitForEvent('download',{timeout:30000});
    await page.click('#primaryBtn');
    const dl=await dlPromise;
    if(!dl.suggestedFilename().endsWith('.webp'))throw Error('Format not applied @'+width+': '+dl.suggestedFilename());
    await page.click('#shellVersions button[data-v="Asli"]');
    const enabled=await page.locator('#primaryBtn').isVisible();
    if(enabled)throw Error('Original version must not be downloadable @'+width);
    await page.click('#shellVersions button[data-v="Bersih"]');
    await page.click('#editorHistoryBtn');
    if(await page.locator('#historySection').evaluate(el=>el.classList.contains('hidden')))throw Error('History inaccessible @'+width);
    await page.close();
    console.log('PASS '+width+'px');
  }
  if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();server.kill('SIGTERM');}
