(() => {
    const params = new URLSearchParams(window.location.search);
    const version = params.get('version');
    if (version) {
        document.querySelectorAll('[data-app-version]').forEach((el) => {
            el.textContent = version;
        });
    }

    const defaultOpen = new Set(['overview', 'user-guide']);

    const setExpanded = (section, expanded) => {
        if (!section) return;
        section.classList.toggle('is-collapsed', !expanded);
        const toggle = section.querySelector('.doc-section__toggle');
        if (toggle) {
            toggle.setAttribute('aria-expanded', String(expanded));
            const label = toggle.querySelector('span');
            if (label) label.textContent = expanded ? 'Collapse' : 'Expand';
        }
    };

    const expandSection = (section) => setExpanded(section, true);

    const setupCollapsibleSections = () => {
        const sections = document.querySelectorAll('section.ui-card');
        sections.forEach((section, index) => {
            if (section.querySelector('.doc-section__body')) return;

            section.classList.add('doc-section');

            const heading = section.querySelector('h2');
            if (!heading) return;

            const sectionId = section.id || `section-${index}`;
            section.id = sectionId;

            const header = document.createElement('div');
            header.className = 'doc-section__header';

            section.insertBefore(header, heading);
            header.appendChild(heading);

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'doc-section__toggle';
            toggle.setAttribute('aria-expanded', 'true');
            toggle.setAttribute('aria-controls', `${sectionId}-body`);
            toggle.innerHTML = '<span>Collapse</span>';
            header.appendChild(toggle);

            const body = document.createElement('div');
            body.className = 'doc-section__body';
            body.id = `${sectionId}-body`;

            while (header.nextSibling) {
                body.appendChild(header.nextSibling);
            }

            section.appendChild(body);

            const shouldOpen = defaultOpen.has(sectionId);
            setExpanded(section, shouldOpen);

            toggle.addEventListener('click', () => {
                const isCollapsed = section.classList.contains('is-collapsed');
                setExpanded(section, isCollapsed);
            });
        });
    };

    const wireTocLinks = () => {
        document.querySelectorAll('.toc a[href^="#"]').forEach((link) => {
            link.addEventListener('click', () => {
                const id = link.getAttribute('href');
                if (!id) return;
                const target = document.querySelector(id);
                if (target) expandSection(target);
            });
        });
    };

    setupCollapsibleSections();
    wireTocLinks();

    if (window.location.hash) {
        const target = document.querySelector(window.location.hash);
        if (target) expandSection(target);
    }
})();
