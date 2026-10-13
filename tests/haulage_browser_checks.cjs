// Run with the local site on :8080 and a headless CDP browser on :9224.
// Outgoing enquiries and account requests are intercepted; nothing is submitted.
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
    const targets = await (await fetch('http://127.0.0.1:9224/json')).json();
    const ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let sequence = 0;
    const pending = new Map();
    const exceptions = [];
    const enquiries = [];
    const registrations = [];
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
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
        if (message.method === 'Fetch.requestPaused') {
            const { requestId, request } = message.params;
            if (request.url.includes('wa.me/')) {
                enquiries.push(new URL(request.url).searchParams.get('text'));
                await send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
            } else {
                registrations.push(JSON.parse(request.postData));
                await send('Fetch.fulfillRequest', {
                    requestId, responseCode: 201,
                    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                    body: Buffer.from('{"message":"Test only"}').toString('base64')
                });
            }
        }
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    const waitFor = async predicate => {
        for (let attempt = 0; attempt < 80; attempt++) {
            if (await predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Timed out waiting for browser state');
    };
    const navigate = async path => {
        await send('Page.navigate', { url: `http://127.0.0.1:8080/${path}` });
        await waitFor(() => evaluate(`location.href.includes(${JSON.stringify(path)}) && document.readyState === 'complete'`));
    };
    const selectService = value => evaluate(`serviceType.value = ${JSON.stringify(value)}; serviceType.dispatchEvent(new Event('change'));`);
    const fill = values => evaluate(`Object.entries(${JSON.stringify(values)}).forEach(([id, value]) => { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); });`);
    const capture = async name => {
        fs.mkdirSync('previews/haulage', { recursive: true });
        const result = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`previews/haulage/${name}.png`, Buffer.from(result.data, 'base64'));
    };
    try {
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Fetch.enable', { patterns: [{ urlPattern: '*wa.me/*' }, { urlPattern: '*/api/vendor' }] });
        await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await navigate('services.html#vendors');
        assert.equal(await evaluate(`document.querySelector('#vendors a[href*="service=bulk"]').textContent.trim()`), 'Request bulk haulage ↗');
        await evaluate(`document.querySelector('#vendors a[href*="service=bulk"]').click()`);
        await waitFor(() => evaluate(`typeof updateServiceFields === 'function' && serviceType.value === 'bulk'`));
        assert.deepEqual(await evaluate(`Array.from(serviceType.options, option => option.value).filter(Boolean)`), ['subscription', 'bulk']);
        assert(await evaluate(`!!document.getElementById('quickExpressForm')`));
        assert(await evaluate(`!bulkFields.hidden && accountFields.hidden && document.getElementById('vendorPassword').disabled && monthlyVolume.disabled && !bulkHandling.required`));
        assert(await evaluate(`getComputedStyle(document.getElementById('subscriptionRules')).display === 'none'`));
        assert(await evaluate(`!vendorForm.checkValidity()`));
        assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
        await evaluate(`document.getElementById('get-started').scrollIntoView({ behavior: 'instant' })`);
        await capture('desktop');
        const details = {
            'get-started-field-1': 'Test Vendor', 'get-started-field-2': 'Test & Co',
            'get-started-field-3': '08000000000', 'get-started-field-4': 'haulage@example.test',
            bulkDetails: 'Chairs & tables\nKeep dry', bulkQuantity: '20 cartons', bulkSize: '500 kg',
            bulkPickup: '10 Test Street, Yaba, Lagos', bulkDropoff: '20 Test Road, Ikeja, Lagos',
            bulkDate: '2099-12-01'
        };
        await fill(details);
        assert(await evaluate(`vendorForm.checkValidity()`));
        await fill({ bulkDate: '2000-01-01' });
        assert(await evaluate(`!vendorForm.checkValidity()`));
        await fill({ bulkDate: details.bulkDate, bulkDetails: '   ' });
        await evaluate(`vendorForm.requestSubmit()`);
        assert(await evaluate(`!document.getElementById('bulkDetails').validity.valid`));
        assert.equal(enquiries.length, 0);
        await fill({ bulkDetails: details.bulkDetails });
        await selectService('subscription');
        assert(await evaluate(`bulkFields.hidden && bulkDate.disabled && !monthlyVolume.disabled && !accountFields.hidden`));
        await selectService('bulk');
        assert(await evaluate(`vendorForm.checkValidity()`));
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await evaluate(`document.getElementById('serviceFormHeading').scrollIntoView({ behavior: 'instant' })`);
        assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
        await capture('mobile');
        await evaluate(`serviceSubmit.scrollIntoView({ behavior: 'instant', block: 'center' })`);
        assert(await evaluate(`serviceSubmit.getBoundingClientRect().bottom <= innerHeight && serviceSubmit.getBoundingClientRect().top >= 0`));
        await evaluate(`vendorForm.requestSubmit()`);
        await waitFor(() => enquiries.length === 1);
        for (const value of Object.values(details)) assert(enquiries[0].includes(value), `Missing enquiry value: ${value}`);
        assert(enquiries[0].includes('Handling and access notes: None provided'));
        assert(!enquiries[0].includes('Password'));
        assert.equal(registrations.length, 0);
        await navigate('get-started.html?service=bulk&plan=basic#get-started');
        assert(await evaluate(`serviceType.value === 'bulk' && selectedPlan.value === ''`));
        await navigate('get-started.html?plan=basic#get-started');
        assert(await evaluate(`serviceType.value === 'subscription' && selectedPlan.value === 'basic'`));
        await selectService('bulk');
        assert(await evaluate(`selectedPlan.value === ''`));
        await selectService('subscription');
        assert(await evaluate(`bulkDate.disabled && !monthlyVolume.disabled`));
        await fill({ ...details, vendorPassword: 'Check-only-password', 'get-started-field-5': 'Retail', monthlyVolume: '1–30' });
        await evaluate(`vendorForm.requestSubmit()`);
        await waitFor(() => registrations.length === 1);
        assert.equal(registrations[0].plan, '');
        assert.equal(registrations[0].service, 'subscription');
        assert.equal(registrations[0].monthlyVolume, '1–30');
        assert.equal(registrations[0].businessType, 'Retail');
        assert(!Object.hasOwn(registrations[0], 'bulkDetails'));
        await waitFor(() => evaluate(`location.pathname === '/portal.html'`));
        await navigate('get-started.html?service=unknown#get-started');
        assert(await evaluate(`serviceType.value === '' && bulkFields.hidden`));
        assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
        console.log('PASS: haulage links, mobile/desktop layout, required fields, dates, service switching, full WhatsApp message and registration regression. No enquiries or accounts submitted.');
    } finally {
        await send('Fetch.disable');
        ws.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
