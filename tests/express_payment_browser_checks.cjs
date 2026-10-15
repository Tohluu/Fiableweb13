// Fake provider on :8097; checkout navigation is intercepted before networking.
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9226/json')).json();
  const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [], checkouts = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
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
      checkouts.push(message.params.request.url);
      await send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from('<!doctype html><title>Fake checkout</title><p>Test checkout only. No external requests or charges.</p>').toString('base64') });
    }
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Timed out: ' + expression);
  };
  let navigation = 0;
  const navigate = async path => {
    const url = new URL(path, 'http://127.0.0.1:8097/');
    url.searchParams.set('browserCheck', String(++navigation));
    await send('Page.navigate', { url: url.href });
    await wait(`location.hostname==='127.0.0.1' && document.readyState==='complete'`);
  };
  const fill = values => evaluate(`Object.entries(${JSON.stringify(values)}).forEach(([id,value])=>{const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));})`);
  const capture = async name => {
    fs.mkdirSync('previews/checkout', { recursive: true });
    fs.writeFileSync(`previews/checkout/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  };
  const prepare = async email => {
    await navigate('get-started.html#quick-express');
    await evaluate(`document.querySelector('[name="bookingMethod"][value="website"]').click()`);
    await wait(`!expressPayOnline.disabled && expressPickupLocation.options.length>10`);
    await fill({ quickExpressName: 'Checkout Customer', quickExpressPhone: '08000000000', quickExpressPickup: '10 Checkout Street', quickExpressDropoff: '20 Checkout Road', quickExpressPackage: 'Clothing, 2 kg', expressRecipientName: 'Checkout Recipient', expressRecipientPhone: '08000000001', expressPickupLocation: 'yaba', expressDropoffLocation: 'ikeja', expressPaymentEmail: email });
    await evaluate(`expressDropoffLocation.dispatchEvent(new Event('change'));expressPayOnline.click()`);
    await wait(`!expressSubmit.disabled`);
  };
  const submit = async () => {
    await evaluate(`quickExpressForm.requestSubmit()`);
    await wait(`location.hostname==='checkout.paystack.com' && document.readyState==='complete'`);
    const reference = new URL(checkouts.at(-1)).pathname.slice(1);
    assert(reference.startsWith('FL-PAY-'));
    return reference;
  };
  const returnFromCheckout = async (reference, mode = 'return') => {
    await navigate(`get-started.html?expressPayment=${mode}&reference=${reference}#quick-express`);
    await wait(`!expressConfirmation.hidden && expressConfirmation.textContent.includes('Tracking code:')`);
  };
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.clearBrowserCookies');
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://checkout.paystack.com/*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await navigate('get-started.html#quick-express');
    await evaluate(`window.originalPaymentFetch=window.fetch;window.fetch=(url,options)=>url==='/api/express/payment-options'?Promise.resolve(new Response(JSON.stringify({paymentsEnabled:false}),{status:200})):originalPaymentFetch(url,options);document.querySelector('[name="bookingMethod"][value="website"]').click()`);
    await wait(`expressPaymentAvailability.textContent.includes('currently unavailable')`);
    assert(await evaluate(`expressPayOnline.disabled && expressPaymentEmail.disabled`));
    await prepare('');
    assert(await evaluate(`expressPaymentEmail.required && !quickExpressForm.checkValidity() && expressSubmit.textContent==='Book and pay online'`));
    await evaluate(`document.querySelector('[name="expressPaymentMode"][value="later"]').click()`);
    assert(await evaluate(`expressPaymentEmail.disabled && quickExpressForm.checkValidity()`));
    await evaluate(`expressPayOnline.click()`);
    await fill({ expressPaymentEmail: 'payer@example.test' });
    await evaluate(`document.querySelector('.express-payment-options').scrollIntoView({behavior:'instant',block:'center'})`);
    await capture('desktop-payment-options');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
    await evaluate(`document.querySelector('.express-payment-options').scrollIntoView({behavior:'instant',block:'start'})`);
    await capture('mobile-payment-options');
    const paidReference = await submit();
    await returnFromCheckout(paidReference);
    assert(await evaluate(`expressConfirmation.textContent.includes('payment is confirmed') && expressConfirmation.textContent.includes('Payment received: ₦4,000') && expressConfirmation.textContent.includes('FL-RCPT-')`));
    assert(await evaluate(`!Array.from(expressConfirmation.querySelectorAll('button')).some(button=>button.textContent==='Pay online') && quickExpressForm.hidden && document.documentElement.scrollWidth<=innerWidth`));
    await capture('mobile-payment-receipt');
    // Reopening a callback is idempotent and works without session storage.
    await evaluate(`sessionStorage.clear()`);
    await returnFromCheckout(paidReference);
    assert(await evaluate(`expressConfirmation.textContent.includes('Payment received')`));

    await prepare('cancelled@example.test');
    const cancelledReference = await submit();
    await returnFromCheckout(cancelledReference, 'cancelled');
    assert(await evaluate(`expressConfirmation.textContent.includes('Payment was not completed') && Array.from(expressConfirmation.querySelectorAll('button')).some(button=>button.textContent==='Pay online')`));
    await capture('mobile-cancelled-payment');

    await prepare('pending@example.test');
    const pendingReference = await submit();
    await returnFromCheckout(pendingReference);
    assert(await evaluate(`expressConfirmation.textContent.includes('not confirmed yet')`));
    await evaluate(`Array.from(expressConfirmation.querySelectorAll('button')).find(button=>button.textContent==='Check payment status').click()`);
    await wait(`expressConfirmation.textContent.includes('payment is confirmed')`);

    await prepare('initialize-failure@example.test');
    await evaluate(`quickExpressForm.requestSubmit()`);
    await wait(`expressConfirmation.textContent.includes('Unable to start online payment')`);
    const savedOrderRef = await evaluate(`JSON.parse(sessionStorage.getItem('fiableExpressCheckout')).orderRef`);
    await evaluate(`Array.from(expressConfirmation.querySelectorAll('button')).find(button=>button.textContent==='Pay online').click()`);
    await wait(`location.hostname==='checkout.paystack.com' && document.readyState==='complete'`);
    const retriedReference = new URL(checkouts.at(-1)).pathname.slice(1);
    await returnFromCheckout(retriedReference);
    assert(await evaluate(`expressConfirmation.textContent.includes(${JSON.stringify(savedOrderRef)}) && expressConfirmation.textContent.includes('payment is confirmed')`));

    await evaluate(`fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'Batch-check-password'})}).then(r=>r.status)`);
    const summary = await evaluate(`fetch('/api/admin/finance/overview').then(r=>r.json())`);
    assert.equal(summary.yearly.websiteRevenue, 12000);
    const orders = await evaluate(`fetch('/api/admin/orders?bookingType=express').then(r=>r.json()).then(r=>r.orders)`);
    assert.equal(orders.length, 4);
    assert.equal(orders.filter(order => order.paymentStatus === 'paid' && order.paymentMethod === 'paystack').length, 3);
    assert.deepEqual(errors, []);
    console.log('PASS: disabled payments, online/later selection, receipt email validation, secure redirect, mobile checkout/receipt, callback idempotence, cancellation, pending checks, initialization recovery without duplicate bookings and automatic admin revenue. No external charges.');
  } finally { ws.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
