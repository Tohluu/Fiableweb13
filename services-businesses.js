(() => {
    const grid = document.getElementById('businessGrid');
    const toggle = document.getElementById('businessMotionToggle');
    if (!grid || !toggle) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const label = toggle.querySelector('span');
    let paused = false;
    let inView = true;

    function updateMotion() {
        grid.classList.toggle('is-paused', paused || reducedMotion.matches);
        grid.classList.toggle('is-offscreen', !inView || document.hidden);
        toggle.hidden = reducedMotion.matches;
        toggle.setAttribute('aria-pressed', String(paused));
        label.textContent = paused ? 'Resume animation' : 'Pause animation';
    }

    toggle.addEventListener('click', () => {
        paused = !paused;
        updateMotion();
    });
    reducedMotion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateMotion);

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(entries => {
            inView = entries[0].isIntersecting;
            updateMotion();
        });
        observer.observe(grid);
    }
    updateMotion();
})();
