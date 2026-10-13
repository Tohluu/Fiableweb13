/* Browser styling checks against tests/admin_style_fixture.py and a CDP browser. */
const fs=require('fs'),assert=require('assert');
(async()=>{
 const targets=await(await fetch('http://localhost:9223/json')).json();
 const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);};
 const capture=async name=>{fs.mkdirSync('previews/admin',{recursive:true});fs.writeFileSync(`previews/admin/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));};
 const layout=async name=>{const info=JSON.parse(await evaluate(`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth})`));assert(info.scroll<=info.width,`${name}: ${JSON.stringify(info)}`);};
 await send('Runtime.enable');await send('Page.enable');
 await send('Network.clearBrowserCookies');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8092/admin-login.html'});
 await wait(`!!document.getElementById('adminLoginForm')`);
 await layout('login');await capture('login-mobile');
 await evaluate(`document.getElementById('adminForgotBtn').click()`);
 assert(await evaluate(`!document.getElementById('adminForgotForm').classList.contains('hidden')`));await layout('forgot password');
 await evaluate(`document.getElementById('adminBackToLoginBtn').click()`);
 await send('Page.navigate',{url:'http://127.0.0.1:8092/admin-login.html?reset=style-preview'});
 await wait(`document.getElementById('adminResetForm')&&!document.getElementById('adminResetForm').classList.contains('hidden')`);await layout('reset password');
 await send('Page.navigate',{url:'http://127.0.0.1:8092/admin-login.html'});
 await wait(`!!document.getElementById('adminLoginForm')`);
 await evaluate(`document.getElementById('adminLoginForm').classList.add('hidden');document.getElementById('adminMfaForm').classList.remove('hidden')`);await layout('MFA');await capture('mfa-mobile');
 await evaluate(`document.getElementById('adminMfaBackBtn').click();document.getElementById('adminEmail').value='owner@example.test';document.getElementById('adminPassword').value='Admin-style-password';document.getElementById('adminLoginForm').requestSubmit()`);
 await wait(`location.pathname==='/admin.html'&&!document.body.classList.contains('admin-page-loading')&&!!window.currentAdmin`);
 await wait(`document.getElementById('adminTotalVendors').textContent==='1'`);
 for(const width of [320,390,768,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
  for(const view of ['dashboard','vendors','orders','subscriptions','riders','team','tickets','audit-log','reports','settings']){
   if(width<=700){await evaluate(`document.getElementById('adminMenuToggle').click()`);assert(await evaluate(`document.getElementById('adminSidebar').classList.contains('open')&&getComputedStyle(document.getElementById('adminSidebar')).visibility==='visible'`));}
   await evaluate(`document.querySelector('[data-admin-view="admin-${view}"]').click()`);
   await wait(`document.getElementById('view-admin-${view}').classList.contains('active')`);
   await new Promise(r=>setTimeout(r,150));
   await layout(`${view} at ${width}px`);
   if(width<=700)assert(await evaluate(`!document.getElementById('adminSidebar').classList.contains('open')`));
   if((width===390||width===1440)&&['dashboard','orders','settings','team'].includes(view))await capture(`${view}-${width}`);
  }
 }
 // Exercise the real modal layouts with fixture records and forms.
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
 for(const [view,selector,modal] of [['vendors','.vendor-view-btn','vendorDetailsModal'],['orders','.order-view-btn','orderDetailsModal'],['riders','.rider-view-btn','riderDetailsModal']]){
  await evaluate(`document.querySelector('[data-admin-view="admin-${view}"]').click()`);
  await wait(`!!document.querySelector('#view-admin-${view} ${selector}')`);
  await evaluate(`document.querySelector('#view-admin-${view} ${selector}').click()`);
  await wait(`document.getElementById('${modal}').classList.contains('show')`);
  await layout(`${modal} on mobile`);
  const fits=await evaluate(`(()=>{const d=document.querySelector('#${modal} [role="dialog"]');const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight;})()`);
  assert(fits,`${modal} must fit mobile viewport`);
  assert(await evaluate(`document.querySelector('#${modal} .modal-close, #${modal} .admin-modal-close').getBoundingClientRect().height>=44`));
  await capture(`${modal}-mobile`);
  await evaluate(`document.querySelector('#${modal} .modal-close, #${modal} .admin-modal-close').click()`);
 }
 for(const [view,selector,modal,close] of [['riders','#addRiderBtn','addRiderModal','#closeAddRider'],['riders','.rider-edit-btn','editRiderModal','#closeEditRider'],['team','#addAdminBtn','addAdminModal','#closeAddAdmin']]){
  await evaluate(`document.querySelector('[data-admin-view="admin-${view}"]').click()`);
  await wait(`!!document.querySelector('#view-admin-${view} ${selector}')`);
  await evaluate(`document.querySelector('#view-admin-${view} ${selector}').click()`);
  await wait(`document.getElementById('${modal}').classList.contains('show')`);
  await layout(`${modal} form`);
  const controls=await evaluate(`Array.from(document.querySelectorAll('#${modal} input,#${modal} select,#${modal} button')).filter(el=>el.getClientRects().length && el.getBoundingClientRect().height<43).map(el=>el.id||el.className)`);
  assert.deepEqual(controls,[],`${modal} should have standard control sizes`);
  await capture(`${modal}-mobile`);
  await evaluate(`document.querySelector('${close}').click()`);
 }
 assert.deepEqual(errors,[]);
 ws.close();console.log('PASS: admin login/recovery/MFA layouts, all ten dashboard sections at four widths, mobile navigation and vendor/order/rider dialogs.');
})().catch(e=>{console.error(e);process.exit(1);});
