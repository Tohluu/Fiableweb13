const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app-install.js', 'utf8');
function setup({ standalone = false, ios = false, dismissed = false } = {}) {
    const events = {}, controls = {}, storage = {};
    let banner;
    const context = {
        window: { isSecureContext: true, matchMedia: () => ({ matches: standalone, addEventListener() {} }), addEventListener: (name, fn) => { events[name] = fn; } },
        navigator: { userAgent: ios ? 'iPhone' : 'Android', platform: '', maxTouchPoints: 0 },
        localStorage: { getItem: () => dismissed ? String(Date.now()) : null, setItem: (key, value) => { storage[key] = value; } },
        document: { readyState: 'complete', body: { prepend: node => { banner = node; } }, createElement: () => ({ setAttribute() {}, querySelector: selector => controls[selector] ||= { addEventListener(type, fn) { this[type] = fn; } } }) }
    };
    vm.runInNewContext(source, context);
    return { events, controls, storage, get banner() { return banner; } };
}
test('banner shows and dismissal is saved', () => {
    const app = setup();
    assert.equal(app.banner.hidden, false);
    app.controls['.app-install-close'].click();
    assert.equal(app.banner.hidden, true);
    assert.ok(app.storage['apexwings-install-dismissed']);
    assert.equal(setup({ dismissed: true }).banner.hidden, true);
});
test('installed app does not show promotion', () => {
    assert.equal(setup({ standalone: true }).banner, undefined);
});
test('iPhone gets home screen instructions', async () => {
    const app = setup({ ios: true });
    await app.controls['.app-install-action'].click();
    assert.match(app.controls['#app-install-help'].textContent, /Safari.*Add to Home Screen/);
});
test('native prompt requires click and installation hides banner', async () => {
    const app = setup();
    let prompts = 0, prevented = false;
    app.events.beforeinstallprompt({ preventDefault() { prevented = true; }, async prompt() { prompts++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    assert.equal(prevented, true);
    assert.equal(prompts, 0);
    await app.controls['.app-install-action'].click();
    assert.equal(prompts, 1);
    assert.equal(app.banner.hidden, true);
});
