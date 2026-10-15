// Uses temporary payment_overview_checks.py --serve records on :8096 and CDP :9226.
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9226/json')).json();
  const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      message.error ? task.reject(message.error) : task.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
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
  const capture = async name => {
    fs.mkdirSync('previews/payments', { recursive: true });
    fs.writeFileSync(`previews/payments/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  };
  const selectMonth = async month => evaluate(`paymentOverviewMonth.value=${JSON.stringify(month)};paymentOverviewMonth.dispatchEvent(new Event('change'))`);
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.clearBrowserCookies');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8096/admin-login.html' });
    await wait(`document.readyState==='complete' && !!document.body`);
    await evaluate(`fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'Batch-check-password'})}).then(r=>r.json())`);
    await send('Page.navigate', { url: 'http://127.0.0.1:8096/admin.html' });
    await wait(`!document.body.classList.contains('admin-page-loading') && !!document.querySelector('[data-admin-view="admin-payments"]')`);
    await evaluate(`document.querySelector('[data-admin-view="admin-payments"]').click()`);
    await wait(`paymentOverviewMonth.options.length>=3 && !refreshPaymentOverview.disabled`);
    const year = await evaluate(`paymentOverviewMonth.options[0].value.slice(0,4)`);
    await selectMonth(`${year}-02`);
    assert.deepEqual(await evaluate(`['paymentSubscriptionRevenue','paymentWebsiteRevenue','paymentTotalRevenue','paymentRiderCosts','paymentAfterRiderCosts','paymentUnpaidWebsite'].map(id=>document.getElementById(id).textContent)`), ['₦100,000','₦8,000','₦108,000','₦3,200','₦104,800','₦5,000']);
    assert(await evaluate(`paymentYearTotal.textContent==='₦108,000' && paymentOverviewStatus.textContent.includes('February')`));
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
    await capture('desktop-overview');
    await selectMonth(`${year}-01`);
    assert(await evaluate(`paymentTotalRevenue.textContent==='₦0' && paymentRiderCosts.textContent==='₦4,800' && paymentAfterRiderCosts.textContent==='₦-4,800'`));
    await selectMonth(`${year}-02`);
    await evaluate(`window.overviewOriginalFetch=window.fetch;window.fetch=(url,options)=>url==='/api/admin/finance/overview'?Promise.resolve(new Response(JSON.stringify({error:'Temporary overview failure'}),{status:503})):overviewOriginalFetch(url,options);refreshPaymentOverview.click()`);
    await wait(`!paymentOverviewError.hidden && !refreshPaymentOverview.disabled`);
    assert(await evaluate(`paymentTotalRevenue.textContent==='₦108,000' && paymentOverviewError.textContent.includes('Refresh totals')`));
    await evaluate(`window.fetch=overviewOriginalFetch;refreshPaymentOverview.click()`);
    await wait(`paymentOverviewError.hidden && !refreshPaymentOverview.disabled`);
    assert.equal(await evaluate(`paymentOverviewMonth.value`), `${year}-02`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`window.scrollTo({top:0,behavior:'instant'})`);
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
    await capture('mobile-overview');
    await evaluate(`paymentOverviewMonths.scrollIntoView({behavior:'instant',block:'start'})`);
    assert(await evaluate(`document.querySelector('.payment-overview-table').parentElement.scrollWidth>document.querySelector('.payment-overview-table').parentElement.clientWidth && document.documentElement.scrollWidth<=innerWidth`));
    await capture('mobile-monthly-table');
    // Existing receipt recording must feed the combined dashboard on refresh.
    const received = await evaluate(`fetch('/api/admin/orders/express-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:2,amount:4000,method:'cash'})}).then(r=>r.status)`);
    assert.equal(received, 200);
    await evaluate(`refreshPaymentOverview.click()`);
    await wait(`!refreshPaymentOverview.disabled && paymentUnpaidWebsite.textContent==='₦1,000'`);
    const current = await evaluate(`new Date().toISOString().slice(0,7)`);
    await selectMonth(current);
    assert(await evaluate(`paymentWebsiteRevenue.textContent==='₦4,000' && paymentTotalRevenue.textContent==='₦4,000'`));
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('[data-admin-view="admin-subscriptions"]').click()`);
    await wait(`Array.from(adminRevenueMonthFilter.options).some(option=>option.value===${JSON.stringify(`${year}-02`)})`);
    await evaluate(`adminRevenueMonthFilter.value=${JSON.stringify(`${year}-02`)};adminRevenueMonthFilter.dispatchEvent(new Event('change'))`);
    assert(await evaluate(`selectedMonthRevenue.textContent==='₦100,000' && selectedMonthRiderPayments.textContent==='₦2,400'`));
    // Finance staff can open the same view.
    await evaluate(`fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance@example.test',password:'Batch-check-password'})}).then(r=>r.status)`);
    await send('Page.reload');
    await wait(`!document.body.classList.contains('admin-page-loading')`);
    assert(await evaluate(`!document.querySelector('[data-admin-view="admin-payments"]').hidden`));
    await evaluate(`document.querySelector('[data-admin-view="admin-payments"]').click()`);
    await wait(`paymentOverviewMonth.options.length>=3`);
    assert.deepEqual(errors, []);
    console.log('PASS: combined dashboard figures, month/year selection, subscription isolation, error recovery, mobile layout/table scrolling, live receipt updates and finance access.');
  } finally { ws.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
