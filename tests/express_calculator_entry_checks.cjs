// Calculator-to-express entry: no bookings, messages or payments are submitted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'express-booking.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(search = '') {
  const nodes = new Map(), requests = [];
  let failLocations = false;
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', hidden: false, disabled: false, required: false,
      textContent: '', handlers: {}, options: [],
      addEventListener(event, handler) { this.handlers[event] = handler; },
      replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; },
      setCustomValidity() {}
    });
    return nodes.get(id);
  };
  const radios = [get('whatsappRadio'), get('websiteRadio')];
  const form = get('quickExpressForm');
  form.elements = { bookingMethod: { value: 'whatsapp' }, expressPaymentMode: { value: 'later' } };
  form.querySelectorAll = selector => selector.includes('bookingMethod') ? radios : [];
  const context = {
    document: { getElementById: get }, URLSearchParams,
    location: { search }, crypto: { randomUUID },
    Option: function (text, value) { this.text = text; this.value = value; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/locations') return { ok: !failLocations, json: async () => ({ locations: [
        { id: 'egbeda', label: 'Egbeda' }, { id: 'custom-town', label: 'Custom Town' }
      ] }) };
      if (url === '/api/express/payment-options') return { ok: true, json: async () => ({ paymentsEnabled: false }) };
      if (url === '/api/express/quote') {
        const { pickup, dropoff } = JSON.parse(options.body);
        return { ok: true, json: async () => ({ units: pickup === dropoff ? 1 : 3,
          cost: pickup === dropoff ? 2000 : 6000, unitPrice: 2000 }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { get, form, requests, failLocations(value) { failLocations = value; } };
}

test('calculator route opens website booking, prefills valid areas and fetches a fresh price', async () => {
  const app = fixture('?service=express&pickup=egbeda&dropoff=custom-town');
  await tick();
  assert.equal(app.form.elements.bookingMethod.value, 'website');
  assert.equal(app.get('expressWebsiteFields').hidden, false);
  assert.equal(app.get('expressWebsiteFields').disabled, false);
  assert.equal(app.get('expressPickupLocation').value, 'egbeda');
  assert.equal(app.get('expressDropoffLocation').value, 'custom-town');
  const request = app.requests.find(request => request.url === '/api/express/quote');
  assert.deepEqual(JSON.parse(request.options.body), { pickup: 'egbeda', dropoff: 'custom-town' });
  assert.match(app.get('expressEstimate').textContent, /₦6,000/);
  assert.equal(app.get('expressSubmit').disabled, false);
  assert.equal(app.form.elements.expressPaymentMode.value, 'later');
  assert.equal(app.get('quickExpressPickup').value, '');
  assert.equal(app.get('quickExpressDropoff').value, '');
  assert(!app.requests.some(request => /book|initialize/.test(request.url)));
});

test('same-location routes carry through and ordinary visits keep the normal booking choices', async () => {
  const same = fixture('?service=express&pickup=egbeda&dropoff=egbeda');
  await tick();
  assert.match(same.get('expressEstimate').textContent, /₦2,000.*1 unit/);
  for (const search of ['', '?plan=Growth&pickup=egbeda&dropoff=custom-town', '?pickup=egbeda&dropoff=custom-town']) {
    const normal = fixture(search);
    await tick();
    assert.equal(normal.form.elements.bookingMethod.value, 'whatsapp');
    assert.equal(normal.get('expressWebsiteFields').hidden, true);
    assert.equal(normal.requests.length, 0);
  }
});

test('unknown locations remain unselected and never trigger a quote for an unsupported route', async () => {
  const app = fixture('?service=express&pickup=missing&dropoff=custom-town');
  await tick();
  assert.equal(app.get('expressPickupLocation').value, '');
  assert.equal(app.get('expressDropoffLocation').value, 'custom-town');
  assert.equal(app.get('expressSubmit').disabled, true);
  assert(!app.requests.some(request => request.url === '/api/express/quote'));
});

test('reloading areas keeps the customer current choices instead of restoring the original calculator route', async () => {
  const app = fixture('?service=express&pickup=egbeda&dropoff=custom-town');
  await tick();
  app.get('expressDropoffLocation').value = 'egbeda';
  await app.get('expressDropoffLocation').handlers.change();
  await app.get('expressRetryLocations').handlers.click();
  assert.equal(app.get('expressDropoffLocation').value, 'egbeda');
  assert.match(app.get('expressEstimate').textContent, /₦2,000/);
});
