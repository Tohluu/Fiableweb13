(() => {
  const pickup = document.getElementById('pickup');
  const dropoff = document.getElementById('dropoff');
  const button = document.getElementById('calculate');
  const note = document.getElementById('calcNote');
  const defaultNote = note.textContent;
  const comparison = document.getElementById('calculatorPlanComparison');
  const actions = document.getElementById('calculatorActions');
  const planLink = document.getElementById('calculatorPlanLink');
  const money = value => `₦${value.toLocaleString('en-NG')}`;
  let locationsReady = false;
  let loading = false;
  let calculating = false;
  let catalogKey = '';
  let quoteSequence = 0;

  function clearEstimate() {
    quoteSequence++;
    document.getElementById('unitResult').textContent = '—';
    document.getElementById('costResult').textContent = '—';
    document.getElementById('planResult').textContent = '—';
    comparison.hidden = true;
    actions.hidden = true;
    planLink.hidden = true;
    note.textContent = defaultNote;
  }
  pickup.addEventListener('change', clearEstimate);
  dropoff.addEventListener('change', clearEstimate);

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
        clearEstimate();
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
      clearEstimate();
      note.textContent = 'Unable to load delivery locations. Refresh the page to try again.';
    } finally {
      loading = false;
      updateControls();
    }
  }

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    clearEstimate();
    const sequence = quoteSequence;
    const route = { pickup: pickup.value, dropoff: dropoff.value };
    calculating = true;
    updateControls();
    try {
      const response = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(route)
      });
      const result = await response.json();
      if (sequence !== quoteSequence) return;
      if (!response.ok) throw new Error(result.error || 'Unable to calculate delivery');
      document.getElementById('unitResult').innerHTML = `${result.units} <small>units</small>`;
      document.getElementById('costResult').textContent = money(result.cost);
      document.getElementById('planResult').textContent = result.recommendedPlan;
      const plan = result.planComparison;
      if (plan) {
        document.getElementById('planDeliveryLabel').textContent = `With ${plan.plan}: ${result.units} unit${result.units === 1 ? '' : 's'} × ${money(plan.unitPrice)}`;
        document.getElementById('planDeliveryCost').textContent = money(plan.deliveryCost);
        document.getElementById('planDeliverySaving').textContent = money(plan.savingPerDelivery);
        document.getElementById('planMonthlyPrice').textContent = money(plan.monthlyPrice);
        document.getElementById('planMonthlyUnits').textContent = `${plan.monthlyUnits} units`;
        planLink.textContent = `Choose ${plan.plan} ↗`;
        planLink.href = `get-started.html?service=subscription&plan=${encodeURIComponent(plan.plan)}#get-started`;
        planLink.hidden = false;
        comparison.hidden = false;
      }
      document.getElementById('calculatorExpressLink').href = `get-started.html?service=express&pickup=${encodeURIComponent(route.pickup)}&dropoff=${encodeURIComponent(route.dropoff)}#quick-express`;
      actions.hidden = false;
      note.textContent = 'Express delivery estimate based on the server zone matrix. Final units are confirmed when your booking is reviewed.';
      if (!plan) note.textContent += ' Plan pricing is temporarily unavailable. Please try again later.';
    } catch (error) {
      if (sequence === quoteSequence) toast(error.message);
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
