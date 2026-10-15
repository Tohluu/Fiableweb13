// Run against express_delivery_checks.py --serve and a test CDP browser on :9226.
// Only temporary fixture records are booked. WhatsApp navigation is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const targets = await (await fetch('http://127.0.0.1:9226/json')).json();
  const ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let sequence = 0;
  const pending = new Map(), errors = [], enquiries = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++sequence, { resolve, reject });
    ws.send(JSON.stringify({ id: sequence, method, params }));
  });
  ws.addEventListener('message', async event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      message.error ? task.reject(message.error) : task.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Fetch.requestPaused') {
      enquiries.push(new URL(message.params.request.url).searchParams.get('text'));
      await send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Aborted' });
    }
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Timed out: ' + expression);
  };
  const navigate = async path => {
    await send('Page.navigate', { url: `http://127.0.0.1:8095/${path}` });
    await wait(`location.href.includes(${JSON.stringify(path.split('#')[0])}) && document.readyState === 'complete'`);
  };
  const fill = async values => evaluate(`Object.entries(${JSON.stringify(values)}).forEach(([id,value])=>{const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));})`);
  const screenshot = async name => {
    fs.mkdirSync('previews/express', { recursive: true });
    fs.writeFileSync(`previews/express/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  };
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.clearBrowserCookies');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*wa.me/*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await navigate('get-started.html#quick-express');
    assert(await evaluate(`expressWebsiteFields.hidden && expressWebsiteFields.disabled && expressSubmit.textContent.includes('WhatsApp')`));
    await fill({ quickExpressName: 'WhatsApp Customer', quickExpressPhone: '08000000000', quickExpressPickup: '10 WhatsApp Street', quickExpressDropoff: '20 WhatsApp Road', quickExpressPackage: 'Clothing & shoes' });
    assert(await evaluate(`quickExpressForm.checkValidity()`));
    await evaluate(`quickExpressForm.requestSubmit()`);
    for (let i = 0; i < 50 && !enquiries.length; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(enquiries.length, 1);
    assert(enquiries[0].includes('Clothing & shoes') && enquiries[0].includes('20 WhatsApp Road'));
    await navigate('get-started.html#quick-express');
    await evaluate(`document.querySelector('[value="website"]').click()`);
    await wait(`expressPickupLocation.options.length > 10`);
    assert(await evaluate(`!expressWebsiteFields.hidden && expressRecipientName.required && expressSubmit.disabled`));
    await fill({ quickExpressName: '<img src=x onerror="window.injected=true">', quickExpressPhone: '08000000000', quickExpressPickup: '10 Browser Street', quickExpressDropoff: '20 Browser Road', quickExpressPackage: 'Clothing, 2 kg', expressRecipientName: 'Browser Recipient', expressRecipientPhone: '08000000001', expressPickupLocation: 'yaba', expressDropoffLocation: 'ikeja' });
    await evaluate(`expressDropoffLocation.dispatchEvent(new Event('change'))`);
    await wait(`!expressSubmit.disabled`);
    assert(await evaluate(`expressEstimate.textContent.includes('2,000 per unit') && quickExpressForm.checkValidity()`));
    await evaluate(`document.querySelector('#quick-express .form-box').scrollIntoView({behavior:'instant',block:'start'})`);
    assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
    await screenshot('desktop-options');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`document.querySelector('.express-options').scrollIntoView({behavior:'instant',block:'start'})`);
    assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
    await screenshot('mobile-options');

    // A temporary booking failure preserves all details and lets the customer retry.
    await evaluate(`window.originalExpressFetch=window.fetch;window.fetch=(url,options)=>url==='/api/express/book'?Promise.resolve(new Response(JSON.stringify({error:'Test temporary error'}),{status:503})):originalExpressFetch(url,options);quickExpressForm.requestSubmit()`);
    await wait(`!expressError.hidden && !expressSubmit.disabled`);
    assert(await evaluate(`quickExpressPickup.value==='10 Browser Street' && expressRecipientName.value==='Browser Recipient'`));
    await evaluate(`window.fetch=originalExpressFetch;quickExpressForm.requestSubmit()`);
    await wait(`!expressConfirmation.hidden`);
    assert(await evaluate(`expressConfirmation.textContent.includes('dispatch team') && expressConfirmation.querySelector('a').href.includes('track.html?code=')`));
    const trackingUrl = await evaluate(`expressConfirmation.querySelector('a').href`);
    await evaluate(`expressConfirmation.scrollIntoView({behavior:'instant',block:'center'})`);
    await screenshot('mobile-confirmation');
    await send('Page.navigate', { url: trackingUrl });
    await wait(`document.getElementById('trackStatus')?.textContent.includes('Order Received')`);

    // Sign the fixture rider in, then use the real admin order and assignment controls.
    await evaluate(`fetch('/api/rider/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'express-rider@example.test',password:'Batch-check-password'})}).then(r=>r.json())`);
    await evaluate(`fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'Batch-check-password'})}).then(r=>r.json())`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await navigate('admin.html');
    await wait(`!document.body.classList.contains('admin-page-loading') && !!document.querySelector('#adminOrdersBody .order-view-btn')`);
    await evaluate(`document.querySelector('[data-admin-view="admin-orders"]').click();ordersBookingTypeFilter.value='express';ordersBookingTypeFilter.dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#adminOrdersBody .express-order-label')?.textContent.includes('Express')`);
    assert(await evaluate(`!window.injected && !document.querySelector('#adminOrdersBody img[src="x"]') && document.getElementById('adminOrdersBody').textContent.includes('<img src=x')`));
    await evaluate(`document.querySelector('#adminOrdersBody .order-view-btn').click()`);
    await wait(`document.getElementById('assignRiderSelect')?.options.length>1`);
    assert(await evaluate(`orderDetailsBody.textContent.includes('Customer Phone') && orderDetailsBody.textContent.includes('08000000000') && orderDetailsBody.textContent.includes('10 Browser Street') && !window.injected`), await evaluate(`orderDetailsBody.textContent`));
    assert(await evaluate(`orderDetailsBody.textContent.includes('Payment pending') && !!document.getElementById('markExpressPaymentReceived')`));
    await evaluate(`window.confirm=()=>false;markExpressPaymentReceived.click()`);
    assert(await evaluate(`!!document.getElementById('markExpressPaymentReceived') && orderDetailsBody.textContent.includes('Payment pending')`));
    await evaluate(`window.confirm=()=>true;expressPaymentMethod.value='cash';expressPaymentReference.value='BROWSER-RECEIPT';markExpressPaymentReceived.click()`);
    await wait(`orderDetailsBody.textContent.includes('Payment received') && !document.getElementById('markExpressPaymentReceived')`);
    assert(await evaluate(`orderDetailsBody.textContent.includes('Cash') && orderDetailsBody.textContent.includes('BROWSER-RECEIPT') && !orderDetailsBody.textContent.includes('Payment pending')`));
    await evaluate(`closeOrderDetails.click();document.querySelector('#adminOrdersBody .order-view-btn').click()`);
    await wait(`orderDetailsBody.textContent.includes('Payment received') && document.getElementById('assignRiderSelect')?.options.length>1`);
    await screenshot('admin-express-order');
    await evaluate(`assignRiderSelect.value='1';assignRiderBtn.click()`);
    await wait(`!orderDetailsModal.classList.contains('show')`);
    await wait(`document.getElementById('adminOrdersBody').textContent.includes('Assigned')`);
    await navigate('rider.html');
    await wait(`!!document.querySelector('.rider-view-order-btn')`);
    await evaluate(`document.querySelector('[data-rider-view="deliveries"]').click();document.querySelector('.rider-view-order-btn').click()`);
    await wait(`document.body.textContent.includes('10 Browser Street')`);
    assert(await evaluate(`!window.injected`));
    assert.deepEqual(errors, []);
    console.log('PASS: WhatsApp preserved, mobile booking/tracking, failure recovery, safe admin details, payment confirmation/cancellation/persistence, express assignment and rider visibility.');
  } finally {
    ws.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
