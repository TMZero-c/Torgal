(() => {
    const params = new URLSearchParams(window.location.search);
    const version = params.get('version');
    if (version) {
        document.querySelectorAll('[data-app-version]').forEach((el) => {
            el.textContent = version;
        });
    }

    const defaultOpen = new Set(['overview', 'user-guide']);

    const loadSections = async () => {
        const container = document.querySelector('[data-docs-content]');
        if (!container) return;

        try {
            const manifestUrl = new URL('docs/sections.json', window.location.href);
            const manifestResponse = await fetch(manifestUrl.toString());
            if (!manifestResponse.ok) {
                throw new Error(`Failed to load docs manifest (${manifestResponse.status})`);
            }

            const files = await manifestResponse.json();
            if (!Array.isArray(files)) {
                throw new Error('Docs manifest is not an array');
            }

            const sections = [];
            for (const file of files) {
                if (typeof file !== 'string') continue;
                const sectionUrl = new URL(`docs/sections/${file}`, window.location.href);
                const sectionResponse = await fetch(sectionUrl.toString());
                if (!sectionResponse.ok) {
                    throw new Error(`Failed to load section ${file} (${sectionResponse.status})`);
                }
                const html = await sectionResponse.text();
                sections.push(html);
            }

            container.innerHTML = sections.join('\n');
        } catch (err) {
            console.error('[docs]', err);
            container.innerHTML = `
                <div class="docs-error ui-card">
                    <h2>Docs failed to load</h2>
                    <p>We couldn't load the documentation sections. Please reload the window.</p>
                </div>
            `;
        }
    };

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

    const setupTocObserver = () => {
        const tocLinks = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
        const linkMap = new Map(
            tocLinks
                .map((link) => {
                    const id = link.getAttribute('href')?.slice(1);
                    return id ? [id, link] : null;
                })
                .filter(Boolean)
        );

        let activeId = null;
        const setActive = (id) => {
            if (!id || id === activeId) return;
            activeId = id;
            tocLinks.forEach((link) => link.classList.remove('is-active'));
            const active = linkMap.get(id);
            if (active) active.classList.add('is-active');
        };

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
                if (visible.length) {
                    setActive(visible[0].target.id);
                }
            },
            {
                rootMargin: '-20% 0px -70% 0px',
                threshold: [0.1, 0.25, 0.5],
            }
        );

        document.querySelectorAll('section.ui-card').forEach((section) => observer.observe(section));

        if (window.location.hash) {
            setActive(window.location.hash.slice(1));
        } else if (tocLinks.length) {
            const firstId = tocLinks[0].getAttribute('href')?.slice(1);
            if (firstId) setActive(firstId);
        }
    };

    const createActionsBar = () => {
        const container = document.querySelector('[data-docs-content]');
        if (!container) return;
        if (container.querySelector('.docs-actions')) return;

        const actions = document.createElement('div');
        actions.className = 'docs-actions ui-card';
        actions.innerHTML = `
            <div class="docs-actions__title">Quick actions</div>
            <div class="docs-actions__buttons">
                <button type="button" class="ui-button ui-button--secondary" data-action="expand">Expand all</button>
                <button type="button" class="ui-button ui-button--secondary" data-action="collapse">Collapse all</button>
                <button type="button" class="ui-button ui-button--secondary" data-action="top">Back to top</button>
            </div>
        `;

        const sections = () => Array.from(document.querySelectorAll('section.ui-card'));
        actions.querySelector('[data-action="expand"]')?.addEventListener('click', () => {
            sections().forEach((section) => setExpanded(section, true));
        });
        actions.querySelector('[data-action="collapse"]')?.addEventListener('click', () => {
            sections().forEach((section) => setExpanded(section, false));
        });
        actions.querySelector('[data-action="top"]')?.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        container.prepend(actions);
    };

    const boot = async () => {
        await loadSections();
        setupCollapsibleSections();
        createActionsBar();
        wireTocLinks();
        setupTocObserver();

        if (window.location.hash) {
            const target = document.querySelector(window.location.hash);
            if (target) expandSection(target);
        }
    };

    boot();
})();
