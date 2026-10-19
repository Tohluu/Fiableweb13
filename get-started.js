const vendorForm = document.getElementById('vendorForm');
const serviceType = document.getElementById('serviceType');
const serviceSubmit = document.getElementById('serviceSubmit');
const selectedPlan = document.getElementById('selectedPlan');
const serviceFields = {
    subscription: document.getElementById('subscriptionFields'),
    bulk: document.getElementById('bulkFields')
};
const params = new URLSearchParams(window.location.search);
const requestedService = params.get('service');
const planParam = params.get('plan');
if (Object.hasOwn(serviceFields, requestedService)) {
    serviceType.value = requestedService;
} else if (planParam) {
    serviceType.value = 'subscription';
}
selectedPlan.value = serviceType.value === 'subscription' ? planParam || '' : '';

const bulkDate = document.getElementById('bulkDate');
const updateMinimumDate = () => {
    const today = new Date();
    bulkDate.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};

const toggleFields = (container, active) => {
    container.hidden = !active;
    container.querySelectorAll('input, select, textarea').forEach(input => {
        input.disabled = !active;
        input.required = active && input.type !== 'hidden' && !input.hasAttribute('data-optional');
        input.setCustomValidity('');
    });
};

const updateServiceFields = () => {
    const isBulk = serviceType.value === 'bulk';
    Object.entries(serviceFields).forEach(([service, fields]) => toggleFields(fields, service === serviceType.value));
    toggleFields(document.getElementById('accountFields'), !isBulk);
    // A plan chosen on the pricing page must never be applied to another service.
    if (serviceType.value !== 'subscription') selectedPlan.value = '';
    document.getElementById('subscriptionRules').hidden = isBulk;
    document.getElementById('bulkGuidance').hidden = !isBulk;
    document.getElementById('serviceEyebrow').textContent = isBulk ? 'Bulk haulage' : 'Become a vendor';
    document.getElementById('serviceHeading').textContent = isBulk ? 'Tell us what needs to move.' : 'Ready to make delivery easier?';
    document.getElementById('serviceDescription').textContent = isBulk
        ? 'Share your load, route and preferred date to request a haulage quote. No account is required.'
        : "Join Apexwings' growing network of Lagos businesses and get access to structured, subscription-based delivery support.";
    document.getElementById('serviceFormHeading').textContent = isBulk ? 'Request a bulk haulage quote' : 'Register for Apexwings services';
    document.getElementById('serviceFormDescription').textContent = isBulk
        ? 'Complete the details below, then send the prepared message to our team on WhatsApp.'
        : 'Choose your service and create your vendor account. You can sign in after registration.';
    document.getElementById('serviceNote').textContent = isBulk
        ? 'This opens WhatsApp with your details. Send the message there to request a quote. Your move is confirmed only after our team agrees the price and availability with you.'
        : 'Monthly subscriptions are paid upfront for the selected plan.';
    serviceSubmit.textContent = isBulk ? 'Continue on WhatsApp ↗' : 'Create vendor account ↗';
    updateMinimumDate();
};

serviceType.addEventListener('change', updateServiceFields);
bulkDate.addEventListener('focus', updateMinimumDate);
vendorForm.addEventListener('input', event => {
    if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
});

vendorForm.addEventListener('submit', event => {
    event.preventDefault();
    updateMinimumDate();
    vendorForm.querySelectorAll('input:required:not(:disabled), textarea:required:not(:disabled)').forEach(input => {
        input.setCustomValidity(input.value.trim() ? '' : 'Please enter this detail.');
    });
    if (!vendorForm.reportValidity()) return;
    const value = id => formValue(vendorForm, `#${id}`);
    const name = value('get-started-field-1');
    const businessName = value('get-started-field-2');
    const phone = value('get-started-field-3');
    const email = value('get-started-field-4');
    if (serviceType.value === 'bulk') {
        const message = [
            'Hello Apexwings, I would like a bulk haulage quote.',
            `Name: ${name}`, `Business: ${businessName}`, `Phone: ${phone}`, `Email: ${email}`,
            `Goods: ${value('bulkDetails')}`, `Quantity and packaging: ${value('bulkQuantity')}`,
            `Estimated weight or dimensions: ${value('bulkSize')}`,
            `Pickup: ${value('bulkPickup')}`, `Destination: ${value('bulkDropoff')}`,
            `Preferred pickup date: ${value('bulkDate')}`,
            `Handling and access notes: ${value('bulkHandling') || 'None provided'}`,
            'Please confirm the quote, vehicle availability and pickup timing.'
        ].join('\n');
        window.location.href = `https://wa.me/2347015414492?text=${encodeURIComponent(message)}`;
        return;
    }
    submitRequest(vendorForm, '/api/vendor', {
        name, businessName, phone, email,
        password: value('vendorPassword'),
        plan: serviceType.value === 'subscription' ? selectedPlan.value : '',
        service: serviceType.value,
        businessType: value('get-started-field-5'),
        monthlyVolume: serviceType.value === 'subscription' ? value('monthlyVolume') : ''
    }, 'Account created. You can now sign in.', () => {
        window.location.href = `portal.html?email=${encodeURIComponent(email)}`;
    });
});

updateServiceFields();
