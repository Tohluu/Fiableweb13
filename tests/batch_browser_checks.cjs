// Run against batch_delivery_checks.py --serve with a CDP browser on :9224.
// All bookings go to the isolated fixture on :8093, never the live data files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
    const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
    const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    const errors = [];
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
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
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
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Network.clearBrowserCookies');
        await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: 'http://127.0.0.1:8093/portal.html' });
        await waitFor(`typeof api === 'function' && typeof addBatchDeliveryRow === 'function'`);
        await evaluate(`api('/api/login', { method: 'POST', body: JSON.stringify({email:'batch@example.test',password:'Batch-check-password'}) })`);
        await send('Page.reload');
        await waitFor(`typeof state !== 'undefined' && !!state.account && LOCATIONS.length > 0 && !document.getElementById('appShell').classList.contains('hidden')`);
        const baseline = await evaluate(`({count:state.deliveries.length,balance:state.account.unitsRemaining})`);
        await evaluate(`switchView('request')`);
        assert(await evaluate(`document.querySelector('.batch-dropoff').options.length === LOCATIONS.length + 1`));
        assert(await evaluate(`document.getElementById('submitBatchDeliveryBtn').disabled`));
        await evaluate(`
            for(let i=0;i<3;i++) addBatchDeliveryRow();
            const set = (selector,value) => { const input=document.querySelector(selector); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); };
            set('#batchPickup','egbeda'); set('#batchDeliveryWindow','Next Day Delivery');
            set('#batchPickupContactName','Test Vendor'); set('#batchPickupPhone','08000000000'); set('#batchPickupAddress','10 Test Street');
            Array.from(document.querySelectorAll('.batch-delivery-row')).forEach((row,index)=>{
                const values={'.batch-dropoff':index<4?'chevron':'ikeja','.batch-recipient-name':'Recipient '+index,'.batch-recipient-phone':'08000000001','.batch-delivery-address':'20 Test Road','.batch-package-description':'Two cartons of clothes, 5 kg'};
                Object.entries(values).forEach(([selector,value])=>{row.querySelector(selector).value=value;});
            });
        `);
        assert(await evaluate(`document.getElementById('batchDeliveryForm').checkValidity()`));
        await evaluate(`previewBatchQuote()`);
        assert(await evaluate(`document.querySelectorAll('.batch-quote-group').length === 2 && !document.getElementById('submitBatchDeliveryBtn').disabled`));
        assert(await evaluate(`document.getElementById('batchQuotePreview').textContent.includes('Total: 29 units') && document.getElementById('batchQuotePreview').textContent.includes('fewer than 3')`));
        await evaluate(`document.getElementById('batchQuotePreview').scrollIntoView({behavior:'instant',block:'center'})`);
        assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
        await capture('review-desktop');
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await waitFor(`document.getElementById('sidebar').getBoundingClientRect().right <= 0`);
        await evaluate(`document.getElementById('batchQuotePreview').scrollIntoView({behavior:'instant',block:'center'})`);
        assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
        await capture('review-mobile');
        await evaluate(`document.querySelector('.batch-delivery-row').scrollIntoView({behavior:'instant',block:'start'})`);
        await capture('form-mobile');
        // Editing any detail invalidates the reviewed quote.
        await evaluate(`document.querySelector('.batch-recipient-name').dispatchEvent(new Event('input',{bubbles:true}))`);
        assert(await evaluate(`document.getElementById('submitBatchDeliveryBtn').disabled && document.getElementById('batchQuotePreview').classList.contains('hidden')`));
        await evaluate(`previewBatchQuote()`);
        await evaluate(`addBatchDeliveryRow()`);
        assert(await evaluate(`document.getElementById('submitBatchDeliveryBtn').disabled`));
        await evaluate(`document.querySelector('.batch-delivery-row:last-child .remove-batch-delivery-btn').click()`);
        // A late response must not restore a quote after the form has changed.
        await evaluate(`window.originalBatchApi=api; api=async (...args)=>{const response=await window.originalBatchApi(...args);if(args[0]==='/api/batch-delivery-quote')await new Promise(resolve=>window.releaseBatchQuote=resolve);return response;}; window.pendingBatchPreview=previewBatchQuote(); void 0;`);
        await waitFor(`typeof window.releaseBatchQuote === 'function'`);
        await evaluate(`document.querySelector('.batch-recipient-name').dispatchEvent(new Event('input',{bubbles:true}));window.releaseBatchQuote();window.pendingBatchPreview`);
        assert(await evaluate(`document.getElementById('submitBatchDeliveryBtn').disabled`));
        await evaluate(`api=window.originalBatchApi; document.getElementById('batchDeliveryWindow').value='Express'; document.getElementById('batchDeliveryWindow').dispatchEvent(new Event('change',{bubbles:true}));previewBatchQuote()`);
        assert(await evaluate(`document.getElementById('batchQuotePreview').textContent.includes('12,000')`));
        await evaluate(`document.getElementById('batchDeliveryWindow').value='Next Day Delivery';document.getElementById('batchDeliveryWindow').dispatchEvent(new Event('change',{bubbles:true}));previewBatchQuote()`);
        await evaluate(`document.getElementById('batchDeliveryForm').requestSubmit()`);
        await waitFor(`!batchSubmitting && state.deliveries.length === ${baseline.count + 6}`);
        assert(await evaluate(`state.account.unitsRemaining === ${baseline.balance - 29} && new Set(state.deliveries.slice(0,6).map(order=>order.trackingCode)).size === 6`));
        assert(await evaluate(`document.getElementById('batchDeliveryRows').children.length === 3 && document.getElementById('submitBatchDeliveryBtn').disabled`));
        await evaluate(`api('/api/admin/login',{method:'POST',body:JSON.stringify({email:'owner@example.test',password:'Batch-check-password'})})`);
        await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: 'http://127.0.0.1:8093/admin.html' });
        await waitFor(`document.querySelectorAll('#adminOrdersBody .batch-group-filter').length >= 6`);
        await evaluate(`document.querySelector('[data-admin-view="admin-orders"]').click()`);
        await evaluate(`document.querySelector('#adminOrdersBody .batch-group-filter').click()`);
        await waitFor(`document.querySelectorAll('#adminOrdersBody .batch-group-filter').length === 2 || document.querySelectorAll('#adminOrdersBody .batch-group-filter').length === 4`);
        assert(await evaluate(`new Set(Array.from(document.querySelectorAll('#adminOrdersBody .batch-group-filter'),button=>button.dataset.batchGroup)).size === 1`));
        await capture('admin-group');
        assert.equal(errors.length, 0, JSON.stringify(errors));
        console.log('PASS: all destination options, desktop/mobile form and review, per-axis savings, edit/race invalidation, express preview, real isolated booking, individual tracking and admin group filtering.');
    } finally {
        ws.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
