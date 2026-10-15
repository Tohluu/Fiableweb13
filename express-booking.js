(() => {
  const form = document.getElementById('quickExpressForm');
  if (!form) return;
  const fields = document.getElementById('expressWebsiteFields');
  const pickup = document.getElementById('expressPickupLocation');
  const dropoff = document.getElementById('expressDropoffLocation');
  const estimate = document.getElementById('expressEstimate');
  const button = document.getElementById('expressSubmit');
  const error = document.getElementById('expressError');
  const confirmation = document.getElementById('expressConfirmation');
  const retry = document.getElementById('expressRetryLocations');
  const onlineOption = document.getElementById('expressPayOnline');
  const paymentAvailability = document.getElementById('expressPaymentAvailability');
  const emailFields = document.getElementById('expressPaymentEmailFields');
  const paymentEmail = document.getElementById('expressPaymentEmail');
  const checkoutStorage = 'fiableExpressCheckout';
  const money = value => `₦${Number(value).toLocaleString('en-NG')}`;
  let locationsReady = false;
  let loading = false;
  let submitting = false;
  let quote = null;
  let quoteVersion = 0;
  let requestId = crypto.randomUUID();
  let lastPayload = '';
  let paymentsEnabled = false;
  const website = () => form.elements.bookingMethod.value === 'website';
  const payOnline = () => website() && form.elements.expressPaymentMode.value === 'online';
  const saveCheckout = value => { try { sessionStorage.setItem(checkoutStorage, JSON.stringify(value)); } catch {} };
  const readCheckout = () => { try { return JSON.parse(sessionStorage.getItem(checkoutStorage) || 'null'); } catch { return null; } };

  async function paymentOptions() {
    try {
      const response = await fetch('/api/express/payment-options', { cache: 'no-store' });
      const result = await response.json();
      paymentsEnabled = response.ok && result.paymentsEnabled === true;
      paymentAvailability.textContent = paymentsEnabled
        ? result.testMode ? 'Test checkout is enabled. Test payments do not collect real money.' : 'Pay the displayed total through secure Paystack checkout.'
        : 'Online payments are currently unavailable. You can still book and arrange payment with dispatch.';
    } catch {
      paymentsEnabled = false;
      paymentAvailability.textContent = 'Unable to check online payment availability. You can arrange payment with dispatch.';
    }
    if (!paymentsEnabled) form.elements.expressPaymentMode.value = 'later';
    controls();
  }

  function controls() {
    fields.hidden = fields.disabled = !website();
    button.textContent = submitting ? 'Booking…' : payOnline() ? 'Book and pay online' : website() ? 'Book on the website' : 'Continue on WhatsApp ↗';
    button.disabled = submitting || (website() && (!locationsReady || !quote));
    form.querySelectorAll('[name="bookingMethod"]').forEach(input => { input.disabled = submitting; });
    onlineOption.disabled = !paymentsEnabled || submitting;
    emailFields.hidden = !payOnline();
    paymentEmail.disabled = !payOnline();
    paymentEmail.required = payOnline();
  }

  async function startCheckout(saved, actionButton, message) {
    actionButton.disabled = true;
    message.textContent = 'Opening secure checkout…';
    try {
      const response = await fetch('/api/express/payments/initialize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: saved.requestId, email: saved.email })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to open checkout. Your booking is saved.');
      const url = new URL(result.authorizationUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.paystack.com') throw new Error('Unable to open secure checkout. Contact dispatch.');
      saveCheckout({ ...saved, reference: result.reference });
      window.location.href = url.href;
    } catch (failure) {
      message.textContent = failure.message;
      message.classList.add('express-confirmation-error');
      actionButton.disabled = false;
    }
  }

  function showConfirmation(booking, saved, payment = null) {
    form.hidden = true;
    const heading = document.createElement('h4');
    heading.textContent = payment?.status === 'successful' ? 'Your delivery payment is confirmed' : 'Your express delivery is booked';
    const reference = document.createElement('p');
    reference.textContent = `Booking ${booking.orderRef} · Tracking code: ${booking.trackingCode}`;
    const note = document.createElement('p');
    note.textContent = payment?.status === 'successful'
      ? `Payment received: ${money(payment.amount)}. Receipt: ${payment.receiptNumber || payment.reference}. Our dispatch team will assign an available rider.`
      : `Delivery total: ${money(booking.estimatedCost)}. Your booking is saved and our dispatch team will assign an available rider. Payment has not been confirmed.`;
    if (payment?.reviewRequired) note.textContent = `Your payment was received, but this booking already has a payment. Contact dispatch with reference ${payment.reference} to review the additional payment.`;
    const link = document.createElement('a');
    link.href = `track.html?code=${encodeURIComponent(booking.trackingCode)}`;
    link.textContent = 'Track your delivery →';
    const actions = document.createElement('div');
    actions.className = 'express-confirmation-actions';
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    if (saved?.requestId && saved?.email && payment?.status !== 'successful' && payment?.paymentStatus !== 'paid') {
      const pay = document.createElement('button');
      pay.type = 'button'; pay.className = 'btn btn-primary'; pay.textContent = 'Pay online';
      pay.addEventListener('click', () => startCheckout(saved, pay, message));
      actions.append(pay);
    }
    if (payment?.reference && payment.status !== 'successful') {
      const check = document.createElement('button');
      check.type = 'button'; check.className = 'btn btn-outline'; check.textContent = 'Check payment status';
      check.addEventListener('click', () => verifyCheckout(payment.reference));
      actions.append(check);
      message.textContent = payment.status === 'failed' ? 'Payment was not completed. You can try again for this booking.' : 'Payment is not confirmed yet. Check its status before trying another payment.';
    }
    const another = document.createElement('button');
    another.type = 'button'; another.className = 'btn btn-outline'; another.textContent = 'Book another delivery';
    another.addEventListener('click', () => {
      confirmation.hidden = true; form.hidden = false;
      history.replaceState(null, '', `${location.pathname}#quick-express`);
      form.querySelector('input').focus();
    });
    actions.append(another);
    confirmation.replaceChildren(heading, reference, note, link, actions, message);
    confirmation.hidden = false;
    confirmation.focus();
    return { payButton: actions.querySelector('.btn-primary'), message };
  }

  async function verifyCheckout(reference) {
    form.hidden = true;
    confirmation.hidden = false;
    confirmation.textContent = 'Confirming your payment…';
    try {
      const response = await fetch('/api/express/payments/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to confirm payment right now.');
      const saved = readCheckout();
      showConfirmation(result.booking, saved?.orderRef === result.booking.orderRef ? saved : null, result);
    } catch (failure) {
      const note = document.createElement('p');
      note.textContent = `${failure.message} Your booking is saved. Payment reference: ${reference}`;
      const check = document.createElement('button');
      check.type = 'button'; check.className = 'btn btn-primary'; check.textContent = 'Check payment status';
      check.addEventListener('click', () => verifyCheckout(reference));
      confirmation.replaceChildren(note, check);
    }
  }

  async function loadLocations() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('/api/locations', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.locations) || !result.locations.length) throw new Error('Unable to load delivery areas. Try again or continue on WhatsApp.');
      for (const [select, label] of [[pickup, 'Choose pickup area'], [dropoff, 'Choose delivery area']]) {
        const value = select.value;
        select.replaceChildren(new Option(label, ''), ...result.locations.map(location => new Option(location.label, location.id)));
        if (result.locations.some(location => location.id === value)) select.value = value;
      }
      locationsReady = true;
      retry.hidden = true;
      await updateQuote();
    } catch (failure) {
      locationsReady = false;
      quote = null;
      quoteVersion++;
      estimate.textContent = failure.message;
      retry.hidden = false;
    } finally {
      loading = false;
      controls();
    }
  }

  async function updateQuote() {
    const version = ++quoteVersion;
    quote = null;
    controls();
    if (!pickup.value || !dropoff.value) {
      estimate.textContent = 'Choose both areas to see your delivery estimate.';
      return;
    }
    estimate.textContent = 'Calculating your delivery estimate…';
    try {
      const response = await fetch('/api/express/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup: pickup.value, dropoff: dropoff.value })
      });
      const result = await response.json();
      if (version !== quoteVersion) return;
      if (!response.ok) throw new Error(result.error || 'Unable to estimate this route.');
      quote = result;
      estimate.textContent = `Estimated delivery: ${money(result.cost)} · ${result.units} ${result.units === 1 ? 'unit' : 'units'} at ${money(result.unitPrice)} per unit. Final price confirmed by our team.`;
    } catch (failure) {
      if (version !== quoteVersion) return;
      estimate.textContent = failure.message;
      retry.hidden = false;
    } finally {
      if (version === quoteVersion) controls();
    }
  }

  form.querySelectorAll('[name="bookingMethod"]').forEach(input => input.addEventListener('change', () => {
    error.hidden = true;
    controls();
    if (website() && !locationsReady) loadLocations();
    if (website()) paymentOptions();
  }));
  form.querySelectorAll('[name="expressPaymentMode"]').forEach(input => input.addEventListener('change', controls));
  pickup.addEventListener('change', updateQuote);
  dropoff.addEventListener('change', updateQuote);
  retry.addEventListener('click', loadLocations);
  form.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement) event.target.setCustomValidity('');
    error.hidden = true;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    form.querySelectorAll('input[required]').forEach(input => {
      input.setCustomValidity(input.value.trim() ? '' : 'Please enter this detail.');
    });
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const value = name => (data.get(name) || '').trim();
    if (!website()) {
      const message = ['Hello Fiable, I would like to request an express delivery.',
        `Name: ${value('name')}`, `Phone: ${value('phone')}`,
        `Pickup: ${value('pickup')}`, `Destination: ${value('dropoff')}`,
        `Package: ${value('package')}`, 'Please confirm availability, price and delivery timing.'].join('\n');
      window.location.href = `https://wa.me/2347015414492?text=${encodeURIComponent(message)}`;
      return;
    }
    if (!quote || !locationsReady) return;
    const payload = {
      pickup: pickup.value, dropoff: dropoff.value,
      pickupContactName: value('name'), pickupPhone: value('phone'), pickupAddress: value('pickup'),
      recipientName: value('recipientName'), recipientPhone: value('recipientPhone'),
      deliveryAddress: value('dropoff'), packageDescription: value('package'),
      quotedCost: quote.cost
    };
    const fingerprint = JSON.stringify(payload);
    if (lastPayload && lastPayload !== fingerprint) requestId = crypto.randomUUID();
    lastPayload = fingerprint;
    submitting = true;
    const selectedOnline = payOnline();
    const receiptEmail = paymentEmail.value.trim();
    error.hidden = true;
    controls();
    try {
      const response = await fetch('/api/express/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId })
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) await updateQuote();
        throw new Error(result.error || 'Unable to book your delivery. Please try again.');
      }
      const saved = selectedOnline ? { requestId, email: receiptEmail, orderRef: result.orderRef, trackingCode: result.trackingCode } : null;
      if (saved) saveCheckout(saved);
      const view = showConfirmation(result, saved);
      if (selectedOnline) await startCheckout(saved, view.payButton, view.message);
      form.reset();
      quote = null;
      requestId = crypto.randomUUID();
      lastPayload = '';
      estimate.textContent = 'Choose both areas to see your delivery estimate.';
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      submitting = false;
      controls();
    }
  });
  controls();
  const returnParams = new URLSearchParams(location.search);
  const returnedReference = returnParams.get('reference') || returnParams.get('trxref');
  if (returnParams.has('expressPayment') && returnedReference) verifyCheckout(returnedReference);
})();
