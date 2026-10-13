const toast = message => { const node = document.getElementById('toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 3600); };
const backToTop = document.getElementById('backToTop');
window.addEventListener('scroll', () => backToTop.classList.toggle('visible', window.scrollY > 500));
backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
const menuButton = document.querySelector('.menu-btn');
const navigation = document.querySelector('.nav-links');
const setMenuOpen = open => {
    navigation.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
};
menuButton.addEventListener('click', () => setMenuOpen(!navigation.classList.contains('open')));
document.querySelectorAll('.nav-links a').forEach(link => link.addEventListener('click', () => setMenuOpen(false)));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && navigation.classList.contains('open')) {
        setMenuOpen(false);
        menuButton.focus();
    }
});
document.querySelectorAll('.faq').forEach((faq, index) => {
    const button = faq.querySelector('button');
    const answer = faq.querySelector('p');
    answer.id = `faq-answer-${index}`;
    button.setAttribute('aria-controls', answer.id);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
        const open = faq.classList.toggle('open');
        button.setAttribute('aria-expanded', String(open));
    });
});
const quickExpressForm = document.getElementById('quickExpressForm');
if (quickExpressForm) quickExpressForm.addEventListener('submit', event => {
    event.preventDefault();
    const fields = Array.from(quickExpressForm.querySelectorAll('input'));
    fields.forEach(field => field.setCustomValidity(field.value.trim() ? '' : 'Please enter this detail.'));
    if (!quickExpressForm.reportValidity()) return;
    const details = new FormData(quickExpressForm);
    const message = ['Hello Fiable, I would like to request an express delivery.',
        `Name: ${details.get('name').trim()}`, `Phone: ${details.get('phone').trim()}`,
        `Pickup: ${details.get('pickup').trim()}`, `Destination: ${details.get('dropoff').trim()}`,
        `Package: ${details.get('package').trim()}`, 'Please confirm availability, price and delivery timing.'].join('\n');
    window.location.href = `https://wa.me/2347015414492?text=${encodeURIComponent(message)}`;
});
if (quickExpressForm) quickExpressForm.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement) event.target.setCustomValidity('');
});
document.querySelectorAll('.password-toggle').forEach(toggle => toggle.addEventListener('click', () => { const input = toggle.parentElement.querySelector('input'); const visible = input.type === 'text'; input.type = visible ? 'password' : 'text'; toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password'); toggle.setAttribute('aria-pressed', String(!visible)); }));
const formValue = (form, selector) => form.querySelector(selector)?.value.trim() || '';
const submitRequest = async (form, endpoint, payload, successMessage, onSuccess) => { const button = form.querySelector('button[type="submit"]'); if (button) button.disabled = true; try { const response = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to send request'); form.reset(); if (form.id === 'vendorForm' && typeof updateServiceFields === 'function') updateServiceFields(); if (onSuccess) onSuccess(result); toast(successMessage); } catch (error) { toast(error.message); } finally { if (button) button.disabled = false; } };
