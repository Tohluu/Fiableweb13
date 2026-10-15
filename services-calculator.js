(() => {
  const pickup = document.getElementById('pickup');
  const dropoff = document.getElementById('dropoff');
  const button = document.getElementById('calculate');
  const note = document.getElementById('calcNote');
  const defaultNote = note.textContent;
  let locationsReady = false;
  let loading = false;
  let calculating = false;
  let catalogKey = '';

  function updateControls() {
    pickup.disabled = dropoff.disabled = !locationsReady;
    button.disabled = !locationsReady || loading || calculating;
  }

  async function loadLocations() {
    if (loading) return;
    loading = true;
    updateControls();
    try {
      const response = await fetch('/api/locations', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load delivery locations');
      const { locations } = await response.json();
      if (!Array.isArray(locations) || !locations.length) throw new Error('No delivery locations available');
      const updatedKey = JSON.stringify(locations);
      if (updatedKey !== catalogKey) {
        for (const select of [pickup, dropoff]) {
          const selected = select.value;
          select.replaceChildren(...locations.map(location => new Option(location.label, location.id)));
          if (locations.some(location => location.id === selected)) select.value = selected;
        }
        catalogKey = updatedKey;
      }
      if (!locationsReady) note.textContent = defaultNote;
      locationsReady = true;
    } catch (error) {
      locationsReady = false;
      note.textContent = 'Unable to load delivery locations. Refresh the page to try again.';
    } finally {
      loading = false;
      updateControls();
    }
  }

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    calculating = true;
    updateControls();
    try {
      const response = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup: pickup.value, dropoff: dropoff.value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to calculate delivery');
      document.getElementById('unitResult').innerHTML = `${result.units} <small>units</small>`;
      document.getElementById('costResult').textContent = `₦${result.cost.toLocaleString()}`;
      document.getElementById('planResult').textContent = result.recommendedPlan;
      note.textContent = 'Express delivery estimate based on the server zone matrix. Final units are confirmed when your booking is reviewed.';
    } catch (error) {
      toast(error.message);
    } finally {
      calculating = false;
      updateControls();
    }
  });

  window.addEventListener('focus', loadLocations);
  window.addEventListener('pageshow', loadLocations);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadLocations();
  });
  loadLocations();
})();
