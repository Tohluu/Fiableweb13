/* Run against tests/rider_portal_checks.py --serve and a local CDP browser. */
const fs = require('fs');
const assert = require('assert');
(async () => {
 const targets = await (await fetch('http://localhost:9223/json')).json();
 const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
 await new Promise(r => ws.addEventListener('open', r, {once:true}));
 let id=0; const pending=new Map(); const errors=[];
 ws.addEventListener('message', e => {
  const m=JSON.parse(e.data);
  if(m.id) { const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(m.error):p.resolve(m.result); }
  if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
 });
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression => {
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
 };
 const waitFor=async(expression)=>{
  for(let i=0;i<60;i++) { if(await evaluate(expression)) return; await new Promise(r=>setTimeout(r,100)); }
  throw Error('Timed out: '+expression);
 };
 const capture=async name=>{
  fs.mkdirSync('previews/rider',{recursive:true});
  fs.writeFileSync(`previews/rider/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 };
 await send('Runtime.enable'); await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8091/rider.html'});
 await waitFor(`!!document.getElementById('riderLoginForm') && typeof initializeRiderPage === 'function'`);
 assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
 await capture('login-mobile');
 await evaluate(`document.getElementById('riderLoginEmail').value='rider1@example.test';document.getElementById('riderLoginPassword').value='wrong';document.getElementById('riderLoginForm').requestSubmit()`);
 await waitFor(`document.getElementById('riderLoginMessage').textContent.includes('Invalid')`);
 await evaluate(`document.getElementById('riderLoginPassword').value='Rider-check-password';document.getElementById('riderLoginForm').requestSubmit()`);
 await waitFor(`document.getElementById('riderCurrentDelivery')?.querySelector('.rider-delivery-card')`);
 assert(await evaluate(`document.getElementById('riderDashboardName').textContent==='Check Rider 1'`));
 await capture('profile-mobile');
 assert(await evaluate(`!window.injected && !document.querySelector('#riderCurrentDelivery img')`));
 await evaluate(`selectRiderView('settings')`);
 await waitFor(`document.getElementById('riderNotifications').textContent.includes('Update for rider 1')`);
 assert(await evaluate(`!document.getElementById('riderNotifications').textContent.includes('Update for rider 2')`));
 await evaluate(`selectRiderView('deliveries');window.prompt=()=>null;document.querySelector('[data-order-id="4"][data-action="decline"]').click()`);
 await new Promise(r=>setTimeout(r,200));
 assert(await evaluate(`document.querySelector('[data-order-id="4"][data-action="accept"]')!==null`));
 await evaluate(`document.querySelector('[data-order-id="1"][data-action="accept"]').click()`);
 await waitFor(`document.querySelector('[data-order-id="1"][data-next-status="arriving_at_pickup"]')`);
 for(const state of ['arriving_at_pickup','picked_up','on_delivery']) {
  await evaluate(`document.querySelector('[data-order-id="1"][data-next-status="${state}"]').click()`);
  await waitFor(`document.querySelector('[data-order-id="1"][data-next-status="${state}"]')===null`);
 }
 await waitFor(`document.querySelector('.rider-proof-form')`);
 assert(await evaluate(`document.querySelector('.rider-proof-camera').getAttribute('capture')==='environment' && !!document.querySelector('.rider-proof-photo')`));
 assert(await evaluate(`(()=>{const camera=document.querySelector('.rider-proof-camera');camera.click=()=>camera.dataset.triggered='true';document.querySelector('.rider-camera-btn').click();const triggered=camera.dataset.triggered==='true';delete camera.click;return triggered;})()`));
 await evaluate(`document.querySelector('.rider-proof-recipient').value='Draft recipient'`);
 await evaluate(`loadRiderDelivery()`);
 assert(await evaluate(`document.querySelector('.rider-proof-recipient').value==='Draft recipient'`));
 await evaluate(`document.querySelector('.rider-proof-recipient').value='';document.querySelector('.rider-view-order-btn[data-order-id="1"]').click()`);
 assert(await evaluate(`!document.getElementById('riderOrderModal').hidden && document.activeElement.id==='riderModalCloseBtn'`));
 assert(await evaluate(`!window.injected && !document.querySelector('#riderModalBody img')`));
 assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
 const modalFits=await evaluate(`(()=>{const modal=document.querySelector('.rider-modal-content');const button=document.querySelector('#riderModalFooter button[type="submit"]');button.scrollIntoView();const rect=button.getBoundingClientRect();return modal.scrollHeight>modal.clientHeight&&rect.bottom<=innerHeight&&rect.top>=0;})()`);
 assert(modalFits, 'Proof submission must be reachable in the mobile modal');
 await capture('proof-mobile');
 await evaluate(`document.querySelector('#riderModalFooter .rider-proof-recipient').value='Modal recipient'`);
 await evaluate(`loadRiderDelivery()`);
 assert(await evaluate(`document.querySelector('#riderModalFooter .rider-proof-recipient').value==='Modal recipient'`));
 await evaluate(`document.getElementById('riderModalCloseBtn').focus();document.getElementById('riderOrderModal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 assert(await evaluate(`document.getElementById('riderOrderModal').hidden && document.body.style.overflow===''`));
 await evaluate(`document.querySelector('.rider-proof-recipient').value='Recipient';const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'proof.png',{type:'image/png'}));const upload=document.querySelector('.rider-proof-photo');upload.files=dt.files;upload.dispatchEvent(new Event('change',{bubbles:true}));const camera=document.querySelector('.rider-proof-camera');camera.files=dt.files;camera.dispatchEvent(new Event('change',{bubbles:true}));`);
 assert(await evaluate(`!document.querySelector('.rider-photo-preview').hidden && !document.querySelector('.rider-proof-photo').required && document.querySelector('.rider-camera-btn').textContent==='Retake photo' && !document.querySelector('.rider-proof-photo').files.length`));
 await evaluate(`loadRiderDelivery()`);
 assert(await evaluate(`!document.querySelector('.rider-photo-preview').hidden && riderCameraPhotos.get(document.querySelector('.rider-proof-form')).file.name==='proof.png'`));
 await evaluate(`document.querySelector('.rider-proof-camera').files=new DataTransfer().files;document.querySelector('.rider-proof-camera').dispatchEvent(new Event('change',{bubbles:true}));`);
 assert(await evaluate(`riderCameraPhotos.get(document.querySelector('.rider-proof-form')).file.name==='proof.png'`));
 await evaluate(`document.querySelector('.rider-proof-recipient').value='';loadRiderDelivery()`);
 assert(await evaluate(`riderCameraPhotos.get(document.querySelector('.rider-proof-form')).file.name==='proof.png'`));
 await evaluate(`document.querySelector('.rider-proof-recipient').value='Recipient'`);
 await evaluate(`document.querySelector('.rider-proof-form').requestSubmit()`);
 await waitFor(`!document.querySelector('.rider-proof-form')`);
 await waitFor(`document.getElementById('riderPreviousDeliveries').textContent.includes('CHECK-1')`);
 await send('Page.navigate',{url:'http://127.0.0.1:8091/rider.html'});
 await waitFor(`document.getElementById('riderDashboardName')?.textContent==='Check Rider 1'`);
 assert(await evaluate(`riderRefreshInterval!==null`), 'Session restored on the plain rider URL must auto-refresh');
 for(const width of [320,390,768,1440]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
  for(const view of ['profile','deliveries','settings']) {
   await evaluate(`selectRiderView('${view}')`);
   assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `Overflow at ${width}px in ${view}`);
   const shortButtons=await evaluate(`Array.from(document.querySelectorAll('button')).filter(b=>b.getClientRects().length && b.getBoundingClientRect().height<43).map(b=>b.className)`);
   assert.deepEqual(shortButtons,[],`Small tap targets at ${width}px in ${view}`);
   if(width===1440 && view==='deliveries') await capture('deliveries-desktop');
   if(width===390 && view==='settings') await capture('settings-mobile');
  }
 }
 await evaluate(`document.getElementById('riderLogoutBtn').click()`);
 await waitFor(`document.querySelector('.rider-login-card')?.style.display==='block'`);
 await evaluate(`document.getElementById('riderLoginEmail').value='rider3@example.test';document.getElementById('riderLoginPassword').value='Rider-check-password';document.getElementById('riderLoginForm').requestSubmit()`);
 await waitFor(`document.querySelector('[data-rider-view="settings"]')?.classList.contains('active') && !document.getElementById('riderChangePasswordForm').hidden`);
 assert(await evaluate(`document.getElementById('riderChangePasswordMessage').textContent.includes('temporary')`));
 await evaluate(`document.getElementById('riderCurrentPassword').value='Rider-check-password';document.getElementById('riderNewPassword').value='Browser-new-password';document.getElementById('riderConfirmPassword').value='Browser-new-password';document.getElementById('riderChangePasswordForm').requestSubmit()`);
 await waitFor(`document.getElementById('riderChangePasswordForm').hidden && !riderMustChangePassword`);
 await evaluate(`fetch('/api/rider/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>loadRiderAccount())`);
 await waitFor(`location.search.includes('expired=true') && document.getElementById('riderLoginMessage')?.textContent.includes('expired')`);
 assert.deepEqual(errors,[]);
 ws.close();
 console.log('PASS: rider browser login, XSS protection, isolated notifications, cancelled decline, lifecycle actions, preserved proof drafts, mobile dialog, photo completion, restored-session refresh, temporary-password settings, logout/session expiry and responsive layouts.');
})().catch(e=>{console.error(e);process.exit(1);});
