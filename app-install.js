(() => {
    'use strict';
    let promptEvent;
    let banner;
    let installed = false;
    const standalone = window.matchMedia('(display-mode: standalone)');
    const isInstalled = () => installed || standalone.matches || navigator.standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const embedded = /FBAN|FBAV|Instagram|; wv\)/i.test(navigator.userAgent);
    const dismissed = () => {
        try { return Date.now() - Number(localStorage.getItem('apexwings-install-dismissed') || 0) < 3 * 86400000; }
        catch { return false; }
    };
    const hide = () => { if (banner) banner.hidden = true; };
    function show() {
        if (!banner || isInstalled() || dismissed()) return;
        banner.hidden = false;
    }
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        promptEvent = event;
        show();
    });
    window.addEventListener('appinstalled', () => { installed = true; promptEvent = null; hide(); });
    standalone.addEventListener('change', () => { if (isInstalled()) hide(); });
    function init() {
        if ('serviceWorker' in navigator && window.isSecureContext) {
            navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
        }
        if (isInstalled()) return;
        banner = document.createElement('aside');
        banner.className = 'app-install';
        banner.setAttribute('aria-label', 'Install the Apexwings app');
        banner.hidden = true;
        banner.innerHTML = '<div class="app-install-inner"><img src="/images/app-192.png" alt="" width="44" height="44"><div class="app-install-copy"><strong>Get the Apexwings app</strong><p id="app-install-help" aria-live="polite">Book and track deliveries straight from your home screen.</p></div><button type="button" class="app-install-action">Install app</button><button type="button" class="app-install-close" aria-label="Dismiss app install banner">&times;</button></div>';
        document.body.prepend(banner);
        const button = banner.querySelector('.app-install-action');
        const help = banner.querySelector('#app-install-help');
        banner.querySelector('.app-install-close').addEventListener('click', () => {
            hide();
            try { localStorage.setItem('apexwings-install-dismissed', String(Date.now())); } catch {}
        });
        button.addEventListener('click', async () => {
            if (promptEvent) {
                const pending = promptEvent;
                promptEvent = null;
                button.disabled = true;
                try {
                    await pending.prompt();
                    const choice = await pending.userChoice;
                    if (choice.outcome === 'accepted') hide();
                } catch {
                    help.textContent = 'Open your browser menu and choose Install app or Add to Home Screen.';
                } finally { button.disabled = false; }
                return;
            }
            help.textContent = embedded
                ? 'Open this link in Safari on iPhone or Chrome on Android, then add Apexwings to your home screen.'
                : ios
                    ? 'In Safari, tap Share (or More, then Share), choose Add to Home Screen, then tap Add. Leave Open as Web App enabled if shown.'
                    : 'Open your browser menu and choose Install app or Add to Home Screen. On a computer, look for the install icon in the address bar. If unavailable, try Chrome or Edge.';
        });
        show();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
