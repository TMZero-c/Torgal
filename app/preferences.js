// Preferences window renderer script
// Uses prefs-schema.js for schema-driven UI generation

const $ = id => document.getElementById(id);

// PREFS_SCHEMA, DEFAULTS, FIELD_TYPES are loaded from prefs-schema.js

let currentSettings = {};
let cudaAvailable = true;

// =============================================================================
// UI Generation
// =============================================================================

/**
 * Generate the entire preferences UI from PREFS_SCHEMA
 */
function generateUI() {
    const tabsContainer = $('tabs');
    const contentContainer = $('tab-content');

    let isFirst = true;
    for (const [tabId, tab] of Object.entries(PREFS_SCHEMA)) {
        // Create tab button
        const tabBtn = document.createElement('div');
        tabBtn.className = 'tab' + (isFirst ? ' active' : '');
        tabBtn.dataset.tab = tabId;
        tabBtn.textContent = tab.label;
        tabsContainer.appendChild(tabBtn);

        // Create tab content
        const tabContent = document.createElement('div');
        tabContent.id = `tab-${tabId}`;
        tabContent.className = 'tab-content' + (isFirst ? ' active' : '');

        // Add sections
        for (const section of tab.sections) {
            tabContent.appendChild(createSection(section));
        }

        contentContainer.appendChild(tabContent);
        isFirst = false;
    }

    // Add button row
    const buttonRow = document.createElement('div');
    buttonRow.className = 'button-row';
    buttonRow.innerHTML = `
        <button id="cancelBtn" class="secondary">Cancel</button>
        <button id="saveBtn">Save & Restart</button>
    `;
    contentContainer.appendChild(buttonRow);

    // Attach tab click handlers
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            $(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });
}

/**
 * Create a section element
 */
function createSection(section) {
    // Handle custom sections
    if (section.custom) {
        return createCustomSection(section);
    }

    const sectionEl = document.createElement('div');
    sectionEl.className = 'section' + (section.style === 'warning' ? ' warning' : '');

    // Title
    const title = document.createElement('h2');
    title.textContent = section.title;
    sectionEl.appendChild(title);

    // Section help text
    if (section.help) {
        const helpEl = document.createElement('div');
        helpEl.className = 'section-help';
        helpEl.textContent = section.help;
        sectionEl.appendChild(helpEl);
    }

    // Fields
    for (const field of section.fields) {
        sectionEl.appendChild(createField(field));
    }

    return sectionEl;
}

/**
 * Create a custom section (model cache, reset, etc.)
 */
function createCustomSection(section) {
    const template = $(`template-${section.custom}`);
    if (template) {
        const clone = template.content.cloneNode(true);
        // Return wrapper div if template has multiple children
        const wrapper = document.createElement('div');
        wrapper.appendChild(clone);
        return wrapper.firstElementChild || wrapper;
    }

    // Fallback: empty section
    const sectionEl = document.createElement('div');
    sectionEl.className = 'section';
    sectionEl.innerHTML = `<h2>${section.title || section.custom}</h2><p>Template not found</p>`;
    return sectionEl;
}

/**
 * Create a form field element
 */
function createField(field) {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.dataset.fieldId = field.id;

    if (field.type === 'checkbox') {
        // Checkbox: label wraps input
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = field.id;
        label.appendChild(input);
        label.appendChild(document.createTextNode(' ' + field.label));
        group.appendChild(label);
    } else {
        // Label above input
        const label = document.createElement('label');
        label.setAttribute('for', field.id);
        label.textContent = field.label;
        group.appendChild(label);

        if (field.type === 'select') {
            group.appendChild(createSelect(field));
        } else if (field.type === 'number') {
            const input = document.createElement('input');
            input.type = 'number';
            input.id = field.id;
            if (field.min !== undefined) input.min = field.min;
            if (field.max !== undefined) input.max = field.max;
            if (field.step !== undefined) input.step = field.step;
            group.appendChild(input);
        } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = field.id;
            group.appendChild(input);
        }
    }

    // Help text
    if (field.help) {
        const helpEl = document.createElement('div');
        helpEl.className = 'help-text';
        helpEl.textContent = field.help;
        group.appendChild(helpEl);
    }

    return group;
}

/**
 * Create a select element with options or optgroups
 */
function createSelect(field) {
    const select = document.createElement('select');
    select.id = field.id;

    if (field.optgroups) {
        // Has option groups
        for (const group of field.optgroups) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;
            for (const opt of group.options) {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.gpuOnly) option.dataset.gpuOnly = 'true';
                optgroup.appendChild(option);
            }
            select.appendChild(optgroup);
        }
    } else if (field.options) {
        // Flat options
        for (const opt of field.options) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.gpuOnly) option.dataset.gpuOnly = 'true';
            select.appendChild(option);
        }
    }

    // Mark entire select as having GPU-only options
    if (field.gpuOnly) {
        select.dataset.gpuOnlyValues = JSON.stringify(field.gpuOnly);
    }

    return select;
}

// =============================================================================
// Settings Loading/Saving
// =============================================================================

/**
 * Load settings from main process and populate form
 */
async function loadSettings() {
    currentSettings = await window.prefsApi.getSettings();
    cudaAvailable = await window.prefsApi.getCudaAvailable();

    // Handle GPU options visibility
    if (!cudaAvailable) {
        hideGpuOptions();
        showNoCudaNotice();
    }

    // Populate form fields
    for (const [key, type] of Object.entries(FIELD_TYPES)) {
        const el = $(key);
        if (!el) continue;

        const value = currentSettings[key] ?? DEFAULTS[key];
        if (type === 'select') {
            el.value = String(value);
        } else if (type === 'checkbox') {
            el.checked = Boolean(value);
        } else {
            el.value = value;
        }
    }

    // Model cache path
    const cachePath = await window.prefsApi.getModelCachePath();
    const cachePathEl = $('modelCachePath');
    if (cachePathEl) cachePathEl.value = cachePath;
}

/**
 * Hide GPU-only options when CUDA is not available
 */
function hideGpuOptions() {
    // Hide individual options marked as GPU-only
    document.querySelectorAll('option[data-gpu-only="true"]').forEach(opt => {
        opt.style.display = 'none';
    });

    // Handle selects with gpuOnly values array
    document.querySelectorAll('select[data-gpu-only-values]').forEach(select => {
        const gpuOnlyValues = JSON.parse(select.dataset.gpuOnlyValues);
        select.querySelectorAll('option').forEach(opt => {
            if (gpuOnlyValues.includes(opt.value)) {
                opt.style.display = 'none';
            }
        });
    });

    // Fix current values that are GPU-only
    const whisperDevice = $('whisperDevice');
    if (whisperDevice && currentSettings.whisperDevice === 'cuda') {
        currentSettings.whisperDevice = 'cpu';
    }

    const whisperComputeType = $('whisperComputeType');
    if (whisperComputeType && ['float16', 'int8_float16'].includes(currentSettings.whisperComputeType)) {
        currentSettings.whisperComputeType = 'int8';
    }

    const embeddingDevice = $('embeddingDevice');
    if (embeddingDevice && currentSettings.embeddingDevice === 'cuda') {
        currentSettings.embeddingDevice = 'cpu';
    }
}

/**
 * Show the no-CUDA notice in the models tab
 */
function showNoCudaNotice() {
    const modelsTab = $('tab-models');
    const template = $('template-no-cuda-notice');
    if (modelsTab && template && !$('no-cuda-notice')) {
        const notice = template.content.cloneNode(true);
        modelsTab.insertBefore(notice, modelsTab.firstChild);
    }
}

/**
 * Collect form values into settings object
 */
function collectFormValues() {
    const settings = {};
    for (const [key, type] of Object.entries(FIELD_TYPES)) {
        const el = $(key);
        if (!el) continue;

        if (type === 'select') {
            // Check if it's a number-valued select
            const numVal = Number(el.value);
            settings[key] = isNaN(numVal) ? el.value : numVal;
        } else if (type === 'checkbox') {
            settings[key] = Boolean(el.checked);
        } else {
            settings[key] = parseFloat(el.value);
        }
    }
    return settings;
}

// =============================================================================
// Event Handlers
// =============================================================================

function attachEventHandlers() {
    // Save button
    $('saveBtn').addEventListener('click', async () => {
        const settings = collectFormValues();
        await window.prefsApi.saveSettings(settings);
        window.prefsApi.restartApp();
    });

    // Cancel button
    $('cancelBtn').addEventListener('click', () => {
        window.close();
    });

    // Reset defaults
    const resetBtn = $('resetDefaults');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            if (confirm('Reset all settings to defaults? This will restart the app.')) {
                await window.prefsApi.saveSettings(DEFAULTS);
                window.prefsApi.restartApp();
            }
        });
    }

    // Open cache folder
    const openCacheFolderBtn = $('openCacheFolder');
    if (openCacheFolderBtn) {
        openCacheFolderBtn.addEventListener('click', async () => {
            await window.prefsApi.openCacheFolder();
        });
    }

    // Clear cache
    const clearCacheBtn = $('clearCache');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            if (confirm('This will delete all downloaded models. They will be re-downloaded on next startup. Continue?')) {
                const result = await window.prefsApi.clearCache();
                if (result.success) {
                    alert(`Cleared ${result.freedMB} MB of cached models.`);
                } else {
                    alert('Failed to clear cache: ' + result.error);
                }
            }
        });
    }
}

// =============================================================================
// Initialize
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    generateUI();
    attachEventHandlers();
    loadSettings();
});
