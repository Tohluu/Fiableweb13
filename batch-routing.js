/* Configurable delivery areas and pickup-specific discount groups. */
document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const panel = $('batchRoutingPanel');
  if (!panel) return;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const locationLabel = value => config?.locations.find(location => location.id === value)?.label || value;
  let config, version, locations = [], canManage = false, dirty = false, busy = false;
  let pricingZones = {}, standardLocationIds = [];
  let editSequence = 0, testSequence = 0;

  async function request(url, body) {
    const response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load delivery routing.');
    return data;
  }
  function message(text, error = false) {
    $('routingMessage').textContent = text;
    $('routingMessage').dataset.error = String(error);
  }
  function invalidateTest() {
    testSequence++;
    $('routingTestResult').replaceChildren();
  }
  function changed() {
    dirty = true;
    editSequence++;
    invalidateTest();
    $('routingSave').disabled = !canManage || busy;
    message('Unsaved changes. Test your groups, then save when ready.');
  }
  const areaOptions = selected => config.areas.map(area =>
    `<option value="${escape(area.id)}" ${area.id === selected ? 'selected' : ''}>${escape(area.label)}</option>`
  ).join('');
  const locationOptions = selected => locations.map(location =>
    `<option value="${escape(location)}" ${location === selected ? 'selected' : ''}>${escape(locationLabel(location))}</option>`
  ).join('');
  const zoneOptions = selected => Object.entries(pricingZones).map(([id, label]) =>
    `<option value="${escape(id)}" ${id === selected ? 'selected' : ''}>${escape(label)}</option>`
  ).join('');
  function refreshLocationChoices() {
    locations = config.locations.map(location => location.id).sort((a, b) => locationLabel(a).localeCompare(locationLabel(b)));
    const area = $('routingLocationArea').value;
    $('routingLocationArea').innerHTML = '<option value="">Select a delivery area</option>' + areaOptions(area);
    const zone = $('routingLocationZone').value;
    $('routingLocationZone').innerHTML = '<option value="">Select a pricing zone</option>' + zoneOptions(zone);
    const pickup = $('routingTestPickup').value || 'egbeda';
    $('routingTestPickup').innerHTML = locationOptions(pickup);
    $('routingTestRows').querySelectorAll('select').forEach(select => {
      const selected = select.value;
      select.innerHTML = locationOptions(selected);
    });
  }

  function renderGroups() {
    const pickup = $('routingPickupArea').value;
    const groups = config.pickupRules[pickup] || config.areas.map(area => ({ id: area.id, label: area.label, areas: [area.id] }));
    $('routingGroups').innerHTML = config.areas.map(area => {
      const group = groups.find(item => item.areas.includes(area.id));
      return `<label>${escape(area.label)}<input data-group-area="${escape(area.id)}" value="${escape(group.label)}" maxlength="100" list="routingGroupNames" ${canManage ? '' : 'disabled'}></label>`;
    }).join('');
    $('routingGroupNames').innerHTML = groups.map(group => `<option value="${escape(group.label)}"></option>`).join('');
  }
  function captureGroups() {
    const groups = new Map();
    $('routingGroups').querySelectorAll('input').forEach(input => {
      const label = input.value.trim();
      const key = label.toLocaleLowerCase();
      if (!groups.has(key)) groups.set(key, { id: `route-${groups.size + 1}`, label, areas: [] });
      groups.get(key).areas.push(input.dataset.groupArea);
    });
    config.pickupRules[$('routingPickupArea').value] = [...groups.values()];
  }
  function renderAreas() {
    refreshLocationChoices();
    const pickup = $('routingPickupArea').value;
    $('routingAreas').innerHTML = config.areas.map(area => `<div class="routing-area-row">
      <label>Area name<input data-area-name="${escape(area.id)}" value="${escape(area.label)}" maxlength="100" ${canManage ? '' : 'disabled'}><small>${area.locations.length} location${area.locations.length === 1 ? '' : 's'}</small></label>
      <button type="button" class="btn outline" data-remove-area="${escape(area.id)}" ${!canManage || area.locations.length ? 'disabled' : ''}>Remove</button>
    </div>`).join('');
    $('routingLocations').innerHTML = locations.map(location => {
      const area = config.areas.find(item => item.locations.includes(location));
      const item = config.locations.find(item => item.id === location);
      const custom = !standardLocationIds.includes(location);
      return `<div class="routing-location-card">
        ${custom ? `<label>Location name<input data-location-name="${escape(location)}" value="${escape(item.label)}" maxlength="100" ${canManage ? '' : 'disabled'}></label>` : `<strong>${escape(item.label)}</strong>`}
        <label>Delivery area<select data-location="${escape(location)}" ${canManage ? '' : 'disabled'}>${areaOptions(area.id)}</select></label>
        ${custom ? `<label>Pricing zone<select data-location-zone="${escape(location)}" ${canManage ? '' : 'disabled'}>${zoneOptions(item.zone)}</select></label>` : `<small>${escape(pricingZones[item.zone])}</small>`}
      </div>`;
    }).join('');
    $('routingPickupArea').innerHTML = areaOptions(pickup);
    renderGroups();
    $('routingAddArea').hidden = !canManage;
    $('routingAddLocationFields').hidden = !canManage;
    $('routingSeparate').hidden = !canManage;
  }

  async function load() {
    if (busy) return;
    busy = true;
    $('routingReload').disabled = true;
    $('routingSave').disabled = true;
    $('routingEditor').inert = true;
    message('Loading saved routing rules...');
    try {
      const data = await request('/api/admin/batch-routing');
      config = data.config; version = data.version; locations = data.locations; canManage = data.canManage;
      pricingZones = data.pricingZones; standardLocationIds = data.standardLocationIds;
      $('routingLocationName').value = '';
      $('routingLocationMessage').textContent = '';
      dirty = false; editSequence++; invalidateTest();
      $('routingEditor').hidden = false;
      $('routingSave').hidden = !canManage;
      $('routingAccessNote').textContent = canManage ? 'You can edit and test these rules. Saved changes affect new batch quotes.'
        : 'You can inspect and test saved rules. An owner or operations manager can save changes.';
      renderAreas();
      if (!$('routingTestRows').children.length) {
        $('routingTestPickup').innerHTML = locationOptions('egbeda');
        addTestRow('lekki-phase-1'); addTestRow('chevron'); addTestRow('sangotedo');
      }
      message('Saved rules loaded. Areas stay separate unless combined for a pickup area.');
    } catch (error) { message(error.message, true); }
    finally {
      busy = false;
      $('routingReload').disabled = false;
      $('routingSave').disabled = !canManage || !dirty;
      $('routingEditor').inert = false;
    }
  }

  $('routingAreas').addEventListener('input', event => {
    const id = event.target.dataset.areaName;
    if (!id || !canManage) return;
    config.areas.find(area => area.id === id).label = event.target.value;
    changed();
  });
  $('routingAreas').addEventListener('change', event => {
    if (event.target.dataset.areaName) renderAreas();
  });
  $('routingAreas').addEventListener('click', event => {
    const id = event.target.dataset.removeArea;
    if (!id || !canManage || config.areas.find(area => area.id === id).locations.length) return;
    config.areas = config.areas.filter(area => area.id !== id);
    delete config.pickupRules[id];
    Object.keys(config.pickupRules).forEach(pickup => {
      config.pickupRules[pickup] = config.pickupRules[pickup].map(group => ({ ...group, areas: group.areas.filter(area => area !== id) })).filter(group => group.areas.length);
    });
    changed(); renderAreas();
  });
  $('routingAddArea').addEventListener('click', () => {
    if (!canManage) return;
    let index = 1;
    while (config.areas.some(area => area.id === `new-area-${index}`)) index++;
    const area = { id: `new-area-${index}`, label: `New area ${index}`, locations: [] };
    config.areas.push(area);
    Object.values(config.pickupRules).forEach(groups => groups.push({ id: area.id, label: area.label, areas: [area.id] }));
    changed(); renderAreas();
  });
  $('routingLocations').addEventListener('change', event => {
    if (!canManage) return;
    if (event.target.dataset.locationName) { renderAreas(); return; }
    const pricedLocation = event.target.dataset.locationZone;
    if (pricedLocation) {
      config.locations.find(location => location.id === pricedLocation).zone = event.target.value;
      changed(); return;
    }
    const location = event.target.dataset.location;
    if (!location) return;
    config.areas.forEach(area => { area.locations = area.locations.filter(value => value !== location); });
    config.areas.find(area => area.id === event.target.value).locations.push(location);
    changed(); renderAreas();
  });
  $('routingLocations').addEventListener('input', event => {
    const id = event.target.dataset.locationName;
    if (!id || !canManage) return;
    config.locations.find(location => location.id === id).label = event.target.value;
    changed();
  });
  $('routingAddLocation').addEventListener('click', () => {
    if (!canManage) return;
    const feedback = $('routingLocationMessage');
    const label = $('routingLocationName').value.trim();
    const zone = $('routingLocationZone').value;
    const area = config.areas.find(area => area.id === $('routingLocationArea').value);
    const nameKey = name => name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLocaleLowerCase();
    const id = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || `location-${Date.now()}`;
    let error = '';
    if (!label || !nameKey(label)) error = 'Enter a neighbourhood or town name.';
    else if (config.locations.some(location => location.id === id || nameKey(location.label) === nameKey(label))) error = 'That location already exists. Use its existing entry or enter a distinct location name.';
    else if (!zone) error = 'Choose a pricing zone for the new location.';
    else if (!area) error = 'Choose a delivery area for the new location.';
    if (error) { feedback.textContent = error; feedback.dataset.error = 'true'; return; }
    config.locations.push({ id, label, zone });
    area.locations.push(id);
    changed(); renderAreas();
    $('routingLocationName').value = '';
    feedback.textContent = `${label} added to your draft. Test it below, then save routing rules to make it available to customers.`;
    feedback.dataset.error = 'false';
  });
  $('routingPickupArea').addEventListener('change', renderGroups);
  $('routingGroups').addEventListener('input', () => {
    if (!canManage) return;
    captureGroups(); changed();
  });
  $('routingSeparate').addEventListener('click', () => {
    if (!canManage) return;
    delete config.pickupRules[$('routingPickupArea').value];
    changed(); renderGroups();
  });
  $('routingReload').addEventListener('click', load);
  $('routingSave').addEventListener('click', async () => {
    if (!canManage || busy) return;
    busy = true;
    $('routingSave').disabled = true; $('routingReload').disabled = true;
    $('routingEditor').inert = true;
    try {
      const data = await request('/api/admin/batch-routing', { config, version });
      config = data.config; version = data.version; dirty = false;
      renderAreas();
      message('Routing rules saved. New quotes will use these groups. Confirmed bookings keep their prices.');
    } catch (error) { message(error.message, true); }
    finally {
      busy = false;
      $('routingSave').disabled = !dirty; $('routingReload').disabled = false;
      $('routingEditor').inert = false;
    }
  });

  function addTestRow(destination = 'ikeja') {
    const row = document.createElement('div');
    row.className = 'routing-test-row';
    row.innerHTML = `<label>Destination<select class="routing-test-destination">${locationOptions(destination)}</select></label>
      <label>Deliveries<input class="routing-test-count" type="number" min="1" max="100" value="3" required></label>
      <button type="button" class="btn outline">Remove</button>`;
    row.querySelector('button').addEventListener('click', () => { row.remove(); invalidateTest(); });
    $('routingTestRows').append(row);
    invalidateTest();
  }
  $('routingAddTest').addEventListener('click', () => addTestRow());
  $('routingTestRows').addEventListener('input', invalidateTest);
  $('routingTestRows').addEventListener('change', invalidateTest);
  $('routingTestPickup').addEventListener('change', invalidateTest);
  $('routingTest').addEventListener('click', async () => {
    const result = $('routingTestResult');
    const sequence = ++testSequence;
    const edit = editSequence;
    try {
      const deliveries = [];
      for (const row of $('routingTestRows').children) {
        const count = row.querySelector('input');
        if (!count.reportValidity()) return;
        if (deliveries.length + Number(count.value) > 100) throw new Error('A test batch can contain up to 100 deliveries.');
        for (let index = 0; index < Number(count.value); index++) deliveries.push({
          pickup: $('routingTestPickup').value, dropoff: row.querySelector('select').value,
          deliveryWindow: 'Next Day Delivery', pickupAddress: 'Routing test',
          pickupContactName: 'Routing test', pickupPhone: 'Routing test'
        });
      }
      result.dataset.error = 'false'; result.textContent = 'Testing delivery groups...';
      const quote = await request('/api/admin/batch-routing/preview', { config, deliveries });
      if (sequence !== testSequence || edit !== editSequence) return;
      result.innerHTML = `<p><strong>${dirty ? 'Unsaved rules' : 'Saved rules'} · Pickup: ${escape(quote.pickupAreaLabel)}</strong></p>`
        + quote.groups.map(group => `<div class="routing-result-group"><strong>${escape(group.label)}</strong>
          <span>${escape(group.destinationAreas.join(', '))}</span>
          <span>${group.deliveryCount} deliveries · ${Math.round(group.discountRate * 100)}% tier · ${group.originalUnits} → ${group.chargedUnits} units</span>
          <span>${group.unitsSaved} units saved${group.discountRate && !group.unitsSaved ? ' after whole-unit rounding' : ''}</span></div>`).join('')
        + `<p><strong>Total: ${quote.chargedUnits} units · ${quote.unitsSaved} units saved.</strong> No bookings or balance changes.</p>`;
    } catch (error) {
      if (sequence !== testSequence) return;
      result.dataset.error = 'true'; result.textContent = error.message;
    }
  });

  try {
    const account = await request('/api/admin/account');
    if (account.mustChangePassword || !(account.permissions || []).some(value => ['*', 'view_batch_routing'].includes(value))) return;
    panel.classList.remove('hidden');
    await load();
  } catch { /* The main admin script handles an expired session. */ }
});
