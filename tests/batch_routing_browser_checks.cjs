// Run after batch_browser_checks.cjs against the isolated fixture on :8093.
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
  const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id); pending.delete(message.id);
      message.error ? task.reject(message.error) : task.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Timed out: ${expression}`);
  };
  const capture = async name => {
    fs.mkdirSync('previews/batch', { recursive: true });
    fs.writeFileSync(`previews/batch/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8093/admin.html' });
    await waitFor(`document.getElementById('routingEditor') && !document.getElementById('routingEditor').hidden`);
    // Reset only the isolated fixture's routing so repeat runs start separately.
    await evaluate(`const initial=await (await fetch('/api/admin/batch-routing')).json();initial.config.pickupRules={};initial.config.locations=initial.config.locations.filter(location=>location.id!=='ogudu');initial.config.areas.forEach(area=>area.locations=area.locations.filter(location=>location!=='ogudu'));initial.config.areas.find(area=>area.id==='lekki').label='Chevron / Ikota';await fetch('/api/admin/batch-routing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:initial.config,version:initial.version})});document.getElementById('routingReload').click()`);
    await waitFor(`document.getElementById('routingMessage').textContent.startsWith('Saved rules loaded')`);
    await evaluate(`document.querySelector('[data-admin-view="admin-settings"]').click();document.getElementById('routingPickupArea').value='alimosho';document.getElementById('routingPickupArea').dispatchEvent(new Event('change'))`);
    await evaluate(`window.routingBaseline=await (await fetch('/api/account/summary')).json();document.getElementById('routingTest').click()`);
    await waitFor(`document.querySelectorAll('.routing-result-group').length===3`);
    await evaluate(`['lekki-phase-1','lekki'].forEach(area=>{const input=document.querySelector('[data-group-area="'+area+'"]');input.value='Island test corridor';input.dispatchEvent(new Event('input',{bubbles:true}));});document.getElementById('routingTest').click()`);
    await waitFor(`document.querySelectorAll('.routing-result-group').length===2`);
    assert(await evaluate(`document.getElementById('routingTestResult').textContent.includes('Unsaved rules') && !document.getElementById('routingSave').disabled`));
    await evaluate(`document.getElementById('routingTestPickup').value='ikeja';document.getElementById('routingTestPickup').dispatchEvent(new Event('change'));document.getElementById('routingTest').click()`);
    await waitFor(`document.querySelectorAll('.routing-result-group').length===3`);
    await evaluate(`document.getElementById('routingTestPickup').value='egbeda';document.getElementById('routingTestPickup').dispatchEvent(new Event('change'));document.getElementById('routingSave').click()`);
    await waitFor(`document.getElementById('routingMessage').textContent.startsWith('Routing rules saved')`);
    await evaluate(`document.getElementById('routingReload').click()`);
    await waitFor(`document.getElementById('routingMessage').textContent.startsWith('Saved rules loaded')`);
    assert(await evaluate(`document.querySelector('[data-group-area="lekki"]').value==='Island test corridor'`));
    // Split and then remove an area, including expansion/pruning of saved pickup rules.
    await evaluate(`document.getElementById('routingAddArea').click();const input=document.querySelector('[data-area-name="new-area-1"]');input.value='Ilasan test area';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));const select=document.querySelector('[data-location="ilasan"]');select.value='new-area-1';select.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('routingSave').click()`);
    await waitFor(`document.getElementById('routingMessage').textContent.startsWith('Routing rules saved')`);
    assert(await evaluate(`document.querySelector('[data-remove-area="new-area-1"]').disabled`));
    await evaluate(`const select=document.querySelector('[data-location="ilasan"]');select.value='lekki-phase-1';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-remove-area="new-area-1"]').click();document.getElementById('routingSave').click()`);
    await waitFor(`document.getElementById('routingMessage').textContent.startsWith('Routing rules saved')`);
    assert(await evaluate(`!document.querySelector('[data-area-name="new-area-1"]')`));
    // Add a previously unsupported location, dry-run it, and publish the list.
    await evaluate(`document.getElementById('routingLocationName').value='Ogudu';document.getElementById('routingLocationZone').value='mainland-east';document.getElementById('routingLocationArea').value='ikeja';document.getElementById('routingAddLocation').click()`);
    assert(await evaluate(`document.querySelector('[data-location="ogudu"]') && document.querySelector('#routingTestPickup option[value="ogudu"]') && document.getElementById('routingLocationMessage').textContent.includes('draft')`));
    assert(await evaluate(`!(await (await fetch('/api/locations')).json()).locations.some(location=>location.id==='ogudu')`));
    await evaluate(`document.getElementById('routingLocationName').value='  OGUDU  ';document.getElementById('routingAddLocation').click()`);
    assert(await evaluate(`document.getElementById('routingLocationMessage').dataset.error==='true' && document.querySelectorAll('[data-location="ogudu"]').length===1`));
    await evaluate(`document.querySelector('.routing-test-destination').value='ogudu';document.getElementById('routingTest').click()`);
    await waitFor(`document.querySelectorAll('.routing-result-group').length===3`);
    await evaluate(`document.getElementById('routingSave').click()`);
    await waitFor(`document.getElementById('routingMessage').textContent.startsWith('Routing rules saved')`);
    assert(await evaluate(`(await (await fetch('/api/locations')).json()).locations.some(location=>location.id==='ogudu' && location.label==='Ogudu')`));
    await evaluate(`document.getElementById('routingReload').click()`);
    await waitFor(`document.getElementById('routingMessage').textContent.startsWith('Saved rules loaded')`);
    assert(await evaluate(`document.querySelector('[data-location-name="ogudu"]').value==='Ogudu'`));
    // Inspect the new location form at desktop and mobile widths.
    await evaluate(`document.querySelector('#routingEditor > details').open=true;document.getElementById('routingAddLocationFields').scrollIntoView({behavior:'instant',block:'center'})`);
    await capture('location-admin-desktop');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`document.getElementById('routingAddLocationFields').scrollIntoView({behavior:'instant',block:'center'})`);
    assert(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`));
    await capture('location-admin-mobile');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('.routing-test-destination').value='lekki-phase-1'`);
    await evaluate(`document.getElementById('routingTest').click()`);
    await waitFor(`document.querySelectorAll('.routing-result-group').length===2`);
    assert(await evaluate(`const after=await (await fetch('/api/account/summary')).json();after.unitsRemaining===routingBaseline.unitsRemaining`));
    await evaluate(`document.querySelectorAll('#routingEditor > details').forEach(details=>details.open=false);document.getElementById('routingTestHeading').scrollIntoView({behavior:'instant',block:'start'})`);
    await capture('routing-admin-desktop');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`document.getElementById('routingTestHeading').scrollIntoView({behavior:'instant',block:'start'})`);
    assert(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`));
    await capture('routing-admin-mobile');
    // Change rules between the customer preview and confirmation.
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8093/portal.html' });
    await waitFor(`typeof state!=='undefined' && !!state.account && LOCATIONS.length>0`);
    assert(await evaluate(`['pickup','dropoff','batchPickup'].every(id=>document.querySelector('#'+id+' option[value="ogudu"]')) && !!document.querySelector('.batch-dropoff option[value="ogudu"]')`));
    await evaluate(`switchView('request');const set=(id,value)=>document.getElementById(id).value=value;set('batchPickup','egbeda');set('batchDeliveryWindow','Next Day Delivery');set('batchPickupContactName','Test Vendor');set('batchPickupPhone','08000000000');set('batchPickupAddress','10 Test Street');Array.from(document.querySelectorAll('.batch-delivery-row')).forEach((row,index)=>{const values={'.batch-dropoff':'chevron','.batch-recipient-name':'Test recipient '+index,'.batch-recipient-phone':'08000000001','.batch-delivery-address':'20 Test Road','.batch-package-description':'Clothing, 1 kg'};Object.entries(values).forEach(([selector,value])=>row.querySelector(selector).value=value);});window.customerBefore={balance:state.account.unitsRemaining,count:state.deliveries.length};await previewBatchQuote()`);
    assert(await evaluate(`!!reviewedBatchQuoteToken && !document.getElementById('submitBatchDeliveryBtn').disabled`));
    await evaluate(`const current=await (await fetch('/api/admin/batch-routing')).json();current.config.areas.find(area=>area.id==='lekki').label='Chevron / Ikota updated';await fetch('/api/admin/batch-routing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:current.config,version:current.version})});document.getElementById('batchDeliveryForm').requestSubmit()`);
    await waitFor(`!batchSubmitting && document.getElementById('toast').textContent.includes('quote has changed')`);
    assert(await evaluate(`state.deliveries.length===customerBefore.count && state.account.unitsRemaining===customerBefore.balance && !!reviewedBatchQuoteToken && !document.getElementById('submitBatchDeliveryBtn').disabled`));
    await evaluate(`document.getElementById('batchDeliveryForm').requestSubmit()`);
    await waitFor(`!batchSubmitting && state.deliveries.length===customerBefore.count+3`);
    assert(errors.length === 0, JSON.stringify(errors));
    console.log('PASS: routing editor, added/duplicate locations, draft tests, public dropdowns, pickup-dependent groups, save/reload, split/remove areas, unchanged balances, desktop/mobile layout and stale-quote review.');
  } finally { ws.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
