// Isolated admin routing page: load, edit and review prices without stored data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

async function fixture(canManage = true) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', innerHTML: '', textContent: '', dataset: {}, handlers: {}, children: [{}],
      classList: { remove() {} }, addEventListener(name, handler) { this.handlers[name] = handler; },
      querySelectorAll() { return []; }, replaceChildren() {}
    });
    return nodes.get(id);
  };
  const config = {
    pricingZones: { 'mainland-east': 'Mainland East', 'mainland-south': 'Mainland South',
      'mainland-south-west': 'Mainland South-West', 'mainland-south-east': 'Mainland South-East' },
    zoneUnits: [{ from: 'mainland-east', to: 'mainland-east', units: 1 },
      { from: 'mainland-south-east', to: 'mainland-east', units: 2 }],
    locations: [{ id: 'magodo', label: 'Magodo', zone: 'mainland-east' },
      { id: 'ojota', label: '<Ojota>', zone: 'mainland-east' },
      { id: 'gbagada', label: 'Gbagada', zone: 'mainland-south-east' }],
    areas: [{ id: 'ikeja', label: 'Dispatch', locations: ['gbagada', 'magodo', 'ojota'] }], pickupRules: {}
  };
  let ready;
  const context = {
    document: { getElementById: get, addEventListener(name, callback) { ready = callback; } },
    fetch: async url => ({ ok: true, json: async () => url === '/api/admin/account'
      ? { permissions: ['view_batch_routing'] }
      : { config, version: 'fixture', canManage, standardLocationIds: [] } })
  };
  vm.runInNewContext(fs.readFileSync('batch-routing.js', 'utf8'), context);
  await ready();
  assert.match(get('routingMessage').textContent, /^Saved rules loaded/);
  return { get, config };
}

test('southern zones appear in location choices and the review shows actual 1-unit routes safely', async () => {
  const { get } = await fixture();
  for (const name of ['Mainland South', 'Mainland South-West', 'Mainland South-East']) {
    assert(get('routingLocationZone').innerHTML.includes(name));
    assert(get('routingLocations').innerHTML.includes(name));
  }
  assert.match(get('routingOneUnitReview').innerHTML, /Magodo, &lt;Ojota&gt;/);
  assert.doesNotMatch(get('routingOneUnitReview').innerHTML, /Gbagada|<Ojota>/);
  get('routingZoneUnits').handlers.input({ target: { dataset: { zoneUnits: '0' }, value: '2' } });
  assert.match(get('routingOneUnitReview').innerHTML, /No routes/);
  assert.equal(get('routingSave').disabled, false);
});

test('the review updates on location reassignment and viewers cannot edit it', async () => {
  const { get } = await fixture();
  get('routingLocations').handlers.change({ target: { dataset: { locationZone: 'gbagada' }, value: 'mainland-east' } });
  assert.match(get('routingOneUnitReview').innerHTML, /Gbagada/);
  const viewer = await fixture(false);
  viewer.get('routingZoneUnits').handlers.input({ target: { dataset: { zoneUnits: '0' }, value: '7' } });
  assert.match(viewer.get('routingOneUnitReview').innerHTML, /Magodo/);
  assert.equal(viewer.get('routingSave').hidden, true);
});

test('directory lists each location beside its zone and area, with search and zone filters', async () => {
  const { get } = await fixture();
  const rows = () => get('routingDirectoryRows').innerHTML;
  assert.match(rows(), /Gbagada<\/th>\s*<td><span[^>]*>Mainland South-East<\/span><\/td>\s*<td>Dispatch/);
  assert.match(rows(), /&lt;Ojota&gt;/);
  assert.doesNotMatch(rows(), /<Ojota>/);
  assert(rows().indexOf('Gbagada') < rows().indexOf('Magodo'));
  assert.match(get('routingDirectoryCount').textContent, /3 of 3.*saved assignments/);

  get('routingDirectorySearch').value = '  MAGODO ';
  get('routingDirectorySearch').handlers.input();
  assert.match(rows(), /Magodo/);
  assert.doesNotMatch(rows(), /Gbagada/);
  assert.match(get('routingDirectoryCount').textContent, /1 of 3/);
  get('routingDirectorySearch').value = 'south-east';
  get('routingDirectorySearch').handlers.input();
  assert.match(rows(), /Gbagada/);
  get('routingDirectorySearch').value = 'dispatch';
  get('routingDirectoryZone').value = 'mainland-east';
  get('routingDirectoryZone').handlers.change();
  assert.match(get('routingDirectoryCount').textContent, /2 of 3/);
  assert.doesNotMatch(rows(), /Gbagada/);
  get('routingDirectorySearch').value = 'missing location';
  get('routingDirectorySearch').handlers.input();
  assert.match(rows(), /No locations match/);
  assert.match(get('routingDirectoryCount').textContent, /0 of 3/);
  assert.equal(get('routingSave').disabled, true);
});

test('directory follows added locations, edited assignments and names, save and reload', async () => {
  const { get } = await fixture();
  get('routingLocationName').value = 'New Town';
  get('routingLocationZone').value = 'mainland-east';
  get('routingLocationArea').value = 'ikeja';
  get('routingAddLocation').handlers.click();
  assert.match(get('routingDirectoryRows').innerHTML, /New Town/);
  assert.match(get('routingDirectoryCount').textContent, /4 of 4.*unsaved changes/);

  get('routingLocations').handlers.change({ target: { dataset: { locationZone: 'new-town' }, value: 'mainland-south' } });
  assert.match(get('routingDirectoryRows').innerHTML, /New Town<\/th>\s*<td><span[^>]*>Mainland South<\/span>/);
  get('routingPricingZones').handlers.input({ target: { dataset: { zoneName: 'mainland-south' }, value: '<South Zone>' } });
  get('routingAreas').handlers.input({ target: { dataset: { areaName: 'ikeja' }, value: '<New Area>' } });
  get('routingLocations').handlers.input({ target: { dataset: { locationName: 'new-town' }, value: '<New Name>' } });
  assert.match(get('routingDirectoryRows').innerHTML, /&lt;New Name&gt;<\/th>\s*<td><span[^>]*>&lt;South Zone&gt;<\/span><\/td>\s*<td>&lt;New Area&gt;/);
  await get('routingSave').handlers.click();
  assert.match(get('routingDirectoryCount').textContent, /saved assignments/);
  await get('routingReload').handlers.click();
  assert.match(get('routingDirectoryRows').innerHTML, /&lt;New Name&gt;/);
});

test('viewers can search the directory and cannot change location assignments', async () => {
  const { get } = await fixture(false);
  get('routingDirectoryZone').value = 'mainland-south-east';
  get('routingDirectoryZone').handlers.change();
  assert.match(get('routingDirectoryCount').textContent, /1 of 3/);
  get('routingLocations').handlers.change({ target: { dataset: { locationZone: 'gbagada' }, value: 'mainland-east' } });
  assert.match(get('routingDirectoryRows').innerHTML, /Gbagada/);
  assert.match(get('routingDirectoryCount').textContent, /saved assignments/);
});

test('new locations automatically get matching delivery areas and keep explicit pickup rules valid', async () => {
  const { get, config } = await fixture();
  config.pickupRules.ikeja = [{ id: 'dispatch', label: 'Dispatch', areas: ['ikeja'] }];
  get('routingLocationName').value = 'New Town';
  get('routingLocationZone').value = 'mainland-east';
  get('routingLocationArea').value = '';
  get('routingAddLocation').handlers.click();
  const area = config.areas.find(area => area.label === 'New Town');
  assert.deepEqual(Array.from(area.locations), ['new-town']);
  assert(config.pickupRules.ikeja.some(group => group.areas.includes(area.id)));
  assert.match(get('routingDirectoryRows').innerHTML, /New Town<\/th>\s*<td><span[^>]*>Mainland East<\/span><\/td>\s*<td>New Town/);
  get('routingLocations').handlers.input({ target: { dataset: { locationName: 'new-town' }, value: 'Renamed Town' } });
  assert.equal(area.label, 'Renamed Town');
  assert.match(get('routingDirectoryRows').innerHTML, /Renamed Town/);
});

test('Opebi, Oregun and Maryland automatically share Ikeja when added', async () => {
  const { get, config } = await fixture();
  config.areas[0].label = 'Ikeja';
  for (const label of ['Opebi', 'Oregun', 'Maryland']) {
    get('routingLocationName').value = label;
    get('routingLocationZone').value = 'mainland-east';
    get('routingLocationArea').value = '';
    get('routingAddLocation').handlers.click();
    assert(config.areas[0].locations.includes(label.toLowerCase()));
  }
  assert.equal(config.areas.length, 1);
  assert.match(get('routingDirectoryCount').textContent, /6 of 6/);
});
