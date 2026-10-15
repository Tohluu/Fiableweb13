// Run with node --test tests/services_calculator_checks.cjs. No saved data is changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services-calculator.js'), 'utf8');
const csrf = fs.readFileSync(path.join(root, 'csrf.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const catalog = [
  { id: 'egbeda', label: 'Egbeda', zone: 'mainland-north' },
  { id: 'ogudu', label: 'Ogudu', zone: 'mainland-east' }
];

function fixture() {
  const events = {}, nodes = new Map(), requests = [], messages = [];
  let locations = catalog, failed = false, quoteFailed = false;
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', disabled: false, textContent: '', options: [], handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
    });
    return nodes.get(id);
  };
  element('calcNote').textContent = 'Delivery estimate';
  const context = vm.createContext({
    Headers,
    Option: function (text, value) { this.text = text; this.value = value; },
    toast: message => messages.push(message),
    addEventListener(event, handler) { events[event] = handler; },
    document: {
      cookie: 'fiable_csrf=test-token', hidden: false,
      getElementById: element,
      addEventListener(event, handler) { events[event] = handler; }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const isCatalog = url === '/api/locations';
      return {
        ok: isCatalog ? !failed : !quoteFailed,
        json: async () => isCatalog ? { locations } : quoteFailed
          ? { error: 'Please check the route' }
          : { units: 3, cost: 4500, recommendedPlan: 'Basic' }
      };
    }
  });
  context.window = context;
  vm.runInContext(csrf, context);
  vm.runInContext(source, context);
  return { events, element, requests, messages, context,
    locations(value) { locations = value; },
    fail(value) { failed = value; },
    failQuote(value) { quoteFailed = value; }
  };
}

test('saved admin locations populate both dropdowns and calculate with the CSRF token', async () => {
  const html = fs.readFileSync(path.join(root, 'services.html'), 'utf8');
  assert(html.indexOf('src="csrf.js"') < html.indexOf('src="services-calculator.js"'));
  const app = fixture();
  assert.equal(app.element('calculate').disabled, true);
  await tick();
  for (const id of ['pickup', 'dropoff']) {
    assert.deepEqual(Array.from(app.element(id).options, item => [item.value, item.text]), [['egbeda', 'Egbeda'], ['ogudu', 'Ogudu']]);
    assert.equal(app.element(id).disabled, false);
  }
  assert.equal(app.requests[0].options.cache, 'no-store');
  app.element('dropoff').value = 'ogudu';
  await app.element('calculate').handlers.click();
  const request = app.requests.at(-1);
  assert.deepEqual(JSON.parse(request.options.body), { pickup: 'egbeda', dropoff: 'ogudu' });
  assert.equal(request.options.headers.get('X-CSRF-Token'), 'test-token');
  assert.equal(app.element('unitResult').innerHTML, '3 <small>units</small>');
  assert.equal(app.element('costResult').textContent, '\u20a64,500');
  assert.equal(app.element('planResult').textContent, 'Basic');
  assert.equal(app.element('calculate').disabled, false);
});

test('returning to the page loads new locations and labels while retaining the selected route', async () => {
  const app = fixture();
  await tick();
  app.element('dropoff').value = 'ogudu';
  app.locations([...catalog.map(item => item.id === 'ogudu' ? { ...item, label: 'Ogudu GRA' } : item), { id: 'new-area', label: '<New area>' }]);
  await app.events.focus();
  assert.equal(app.element('dropoff').value, 'ogudu');
  assert.equal(app.element('dropoff').options[1].text, 'Ogudu GRA');
  assert.equal(app.element('pickup').options[2].text, '<New area>');
  app.context.document.hidden = true;
  const count = app.requests.length;
  app.events.visibilitychange();
  assert.equal(app.requests.length, count);
  app.context.document.hidden = false;
  app.events.visibilitychange();
  await tick();
  assert.equal(app.requests.length, count + 1);
  await app.events.pageshow();
  assert.equal(app.element('dropoff').value, 'ogudu');
});

test('location failures disable calculation, recover on return, and quote errors allow retry', async () => {
  const app = fixture();
  await tick();
  app.fail(true);
  await app.events.focus();
  assert.equal(app.element('calculate').disabled, true);
  assert.equal(app.element('pickup').disabled, true);
  assert.match(app.element('calcNote').textContent, /Unable to load/);
  app.fail(false);
  await app.events.focus();
  assert.equal(app.element('calculate').disabled, false);
  assert.equal(app.element('calcNote').textContent, 'Delivery estimate');
  app.failQuote(true);
  await app.element('calculate').handlers.click();
  assert.deepEqual(app.messages, ['Please check the route']);
  assert.equal(app.element('calculate').disabled, false);
  app.locations([]);
  await app.events.focus();
  assert.equal(app.element('calculate').disabled, true);
});
