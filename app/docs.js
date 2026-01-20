(() => {
    const params = new URLSearchParams(window.location.search);
    const version = params.get('version');
    if (!version) return;
    document.querySelectorAll('[data-app-version]').forEach((el) => {
        el.textContent = version;
    });
})();
