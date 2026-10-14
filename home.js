// Fixed examples of current route units, never live customer or rider data.
const batchExamples = {
    mixed: { original: 30, charged: 29, groups: [
        { label: 'Chevron / Ikota group', detail: '4 deliveries · 5% tier', units: '24 → 23 units', saving: '1 unit saved' },
        { label: 'Ikeja group', detail: '2 deliveries · Normal units', units: '6 units', saving: 'Fewer than 3 in this group' }
    ] },
    lekki: { original: 36, charged: 33, groups: [
        { label: 'Chevron / Ikota group', detail: '6 deliveries · 10% tier', units: '36 → 33 units', saving: '3 units saved' }
    ] },
    ikeja: { original: 18, charged: 17, groups: [
        { label: 'Ikeja group', detail: '6 deliveries · 10% tier', units: '18 → 17 units', saving: '1 unit saved' }
    ] }
};
const batchExampleRoute = document.getElementById('batchExampleRoute');
const batchExampleResult = document.getElementById('batchExampleResult');
batchExampleRoute.addEventListener('change', () => {
    const example = batchExamples[batchExampleRoute.value];
    if (!example) return;
    const saved = example.original - example.charged;
    batchExampleResult.innerHTML = `
        <div class="batch-example-groups">${example.groups.map(group => `
            <div class="batch-example-group"><div><strong>${group.label}</strong><span>${group.detail}</span></div><div><strong>${group.units}</strong><span>${group.saving}</span></div></div>
        `).join('')}</div>
        <div class="batch-example-total"><span>Units for this batch</span><strong>${example.charged}<span> / ${example.original}</span></strong></div>
        <p class="batch-example-saving"><svg class="site-icon" aria-hidden="true"><use href="images/site-icons.svg#check"></use></svg>${saved} unit${saved === 1 ? ' stays' : 's stay'} in your subscription.</p>
    `;
});
