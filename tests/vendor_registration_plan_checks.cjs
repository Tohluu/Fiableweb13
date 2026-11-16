// Services-to-registration flow using the real scripts; no accounts are created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const services = fs.readFileSync(path.join(root, 'services.html'), 'utf8');
const registration = fs.readFileSync(path.join(root, 'get-started.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'get-started.js'), 'utf8');

function fixture(search = '') {
    const nodes = new Map(), submitted = [];
    const get = id => {
        if (!nodes.has(id)) nodes.set(id, {
            value: '', type: 'text', disabled: false, required: false, hidden: false,
            textContent: '', handlers: {}, controls: [],
            addEventListener(event, handler) { this.handlers[event] = handler; },
            querySelectorAll() { return this.controls; },
            hasAttribute() { return false; }, setCustomValidity() {},
            reportValidity() { return !get('selectedPlan').required || Boolean(get('selectedPlan').value); }
        });
        return nodes.get(id);
    };
    get('selectedPlan').type = 'select-one';
    get('registrationPlanFields').controls = [get('selectedPlan')];
    get('subscriptionFields').controls = [get('monthlyVolume')];
    get('accountFields').controls = [get('vendorPassword'), get('get-started-field-5'), get('businessAddress')];
    get('bulkFields').controls = [get('bulkDate'), get('bulkDetails')];
    const context = {
        document: { getElementById: get }, window: { location: { search, href: '' } }, URLSearchParams,
        formValue: (_form, selector) => get(selector.slice(1)).value.trim(),
        submitRequest: (_form, endpoint, payload) => submitted.push({ endpoint, payload })
    };
    vm.runInNewContext(script, context);
    const submit = () => get('vendorForm').handlers.submit({ preventDefault() {} });
    return { get, submitted, submit, context };
}

test('each plan links directly to vendor registration, appears visibly and is submitted correctly', () => {
    const links = [...services.matchAll(/<a[^>]+data-plan="([^"]+)"[^>]+href="([^"]+)"/g)];
    assert.equal(links.length, 3);
    assert.match(registration, /<select id="selectedPlan"[^>]*required/);
    assert.doesNotMatch(registration, /<input id="selectedPlan" type="hidden"/);
    for (const [_, plan, href] of links) {
        const url = new URL(href.replaceAll('&amp;', '&'), 'https://example.test/');
        assert.equal(url.pathname, '/get-started.html');
        assert.equal(url.hash, '#get-started');
        assert.equal(url.searchParams.get('service'), 'subscription');
        const app = fixture(url.search);
        assert.equal(app.get('serviceType').value, 'subscription');
        assert.equal(app.get('serviceHeading').textContent, 'Become a vendor');
        assert.equal(app.get('registrationPlanFields').hidden, false);
        assert.equal(app.get('selectedPlan').disabled, false);
        assert.equal(app.get('selectedPlan').required, true);
        assert.equal(app.get('selectedPlan').value, plan);
        const [price, units] = { Basic: ['67,500', 45], Growth: ['105,000', 75], Business: ['143,000', 110] }[plan];
        const summary = app.get('registrationPlanSummary').textContent;
        assert(summary.includes(`${plan} plan: ₦${price}`));
        assert(summary.includes(`${units} delivery units`));
        app.submit();
        assert.equal(app.submitted.length, 1);
        assert.equal(app.submitted[0].endpoint, '/api/vendor');
        assert.equal(app.submitted[0].payload.plan, plan);
    }
});

test('clicking the card follows its plan link and lets native link clicks navigate normally', () => {
    let click;
    const href = 'https://example.test/get-started.html?service=subscription&plan=Growth#get-started';
    const card = { addEventListener(_event, handler) { click = handler; }, querySelector() { return { href }; } };
    const context = { document: { querySelectorAll: () => [card] }, window: { location: { href: '' } } };
    const inline = [...services.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    vm.runInNewContext(inline, context);
    click({ target: { closest: () => ({}) } });
    assert.equal(context.window.location.href, '');
    click({ target: { closest: () => null } });
    assert.equal(context.window.location.href, href);
});

test('a visitor can change their plan and registration uses the latest choice', () => {
    const app = fixture('?plan=basic');
    assert.equal(app.get('selectedPlan').value, 'Basic');
    app.get('selectedPlan').value = 'Business';
    app.get('selectedPlan').handlers.change();
    assert.match(app.get('registrationPlanSummary').textContent, /Business plan: ₦143,000.*110 delivery units/);
    app.submit();
    assert.equal(app.submitted[0].payload.plan, 'Business');
});

test('missing or invalid plans require a choice without accepting arbitrary URL text', () => {
    for (const search of ['?service=subscription', '?service=subscription&plan=__proto__', '?service=subscription&plan=%3Cscript%3E']) {
        const app = fixture(search);
        assert.equal(app.get('selectedPlan').value, '');
        assert.match(app.get('registrationPlanSummary').textContent, /^Choose a plan/);
        app.submit();
        assert.equal(app.submitted.length, 0);
    }
});

test('bulk and express flows do not inherit a subscription plan', () => {
    const app = fixture('?service=bulk&plan=Growth');
    assert.equal(app.get('selectedPlan').value, '');
    assert.equal(app.get('registrationPlanFields').hidden, true);
    assert.equal(app.get('selectedPlan').disabled, true);
    assert.equal(app.get('selectedPlan').required, false);
    app.submit();
    assert.equal(app.submitted.length, 0);
    assert.match(app.context.window.location.href, /^https:\/\/wa.me\//);
    const express = fixture('?expressPayment=return');
    assert.equal(express.get('registrationPlanFields').hidden, true);
    assert.equal(express.get('selectedPlan').required, false);
    const chosen = fixture('?plan=Growth');
    chosen.get('serviceType').value = 'bulk';
    chosen.get('serviceType').handlers.change();
    assert.equal(chosen.get('selectedPlan').value, '');
    chosen.get('serviceType').value = 'subscription';
    chosen.get('serviceType').handlers.change();
    chosen.submit();
    assert.equal(chosen.submitted.length, 0);
});
