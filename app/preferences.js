// Preferences window renderer script
const $ = id => document.getElementById(id);

// Default settings matching config.py and config.js
const DEFAULTS = {
    // Audio (from app/config.js)
    audioSampleRate: 16000,
    audioChunkSize: 1024,
    silenceRmsThreshold: 0.01,
    silenceSmoothing: 0.7,

    // Audio buffer (from python/config.py)
    audioBufferSeconds: 8,

    // Matching (from python/config.py)
    matchThreshold: 0.55,
    matchCooldownWords: 4,
    matchDiff: 0.09,
    windowWords: 14,
    stayBiasMargin: 0.02,
    forwardBiasMargin: 0.06,
    backBiasMargin: 0.02,

    // Models
    whisperModel: 'distil-large-v3.5',
    whisperDevice: 'cuda',
    whisperComputeType: 'float16',
    embeddingModel: 'BAAI/bge-base-en-v1.5',

    // Voice commands
    triggerCooldownMs: 1500,
    triggerTailWords: 6,

    // Partial matching
    partialFinalizeMs: 1000,
    partialMatchMinWords: 5,

    // Q&A mode
    qaWindowWords: 24,
    qaMatchThreshold: 0.60,
};

// Map of form field IDs to their types
const FIELD_TYPES = {
    audioSampleRate: 'select',
    audioChunkSize: 'select',
    silenceRmsThreshold: 'number',
    silenceSmoothing: 'number',
    audioBufferSeconds: 'number',
    matchThreshold: 'number',
    matchCooldownWords: 'number',
    matchDiff: 'number',
    windowWords: 'number',
    stayBiasMargin: 'number',
    forwardBiasMargin: 'number',
    backBiasMargin: 'number',
    whisperModel: 'select',
    whisperDevice: 'select',
    whisperComputeType: 'select',
    embeddingModel: 'select',
    triggerCooldownMs: 'number',
    triggerTailWords: 'number',
    partialFinalizeMs: 'number',
    partialMatchMinWords: 'number',
    qaWindowWords: 'number',
    qaMatchThreshold: 'number',
};

let currentSettings = {};

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        $(`tab-${tab.dataset.tab}`).classList.add('active');
    });
});

// Load settings from main process
async function loadSettings() {
    currentSettings = await window.prefsApi.getSettings();

    // Populate form fields
    for (const [key, type] of Object.entries(FIELD_TYPES)) {
        const el = $(key);
        if (!el) continue;

        const value = currentSettings[key] ?? DEFAULTS[key];
        if (type === 'select') {
            el.value = String(value);
        } else {
            el.value = value;
        }
    }

    // Model cache path
    const cachePath = await window.prefsApi.getModelCachePath();
    $('modelCachePath').value = cachePath;
}

// Collect form values
function collectFormValues() {
    const settings = {};
    for (const [key, type] of Object.entries(FIELD_TYPES)) {
        const el = $(key);
        if (!el) continue;

        if (type === 'select') {
            // Check if it's a number-valued select
            const numVal = Number(el.value);
            settings[key] = isNaN(numVal) ? el.value : numVal;
        } else {
            settings[key] = parseFloat(el.value);
        }
    }
    return settings;
}

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
$('resetDefaults').addEventListener('click', async () => {
    if (confirm('Reset all settings to defaults? This will restart the app.')) {
        await window.prefsApi.saveSettings(DEFAULTS);
        window.prefsApi.restartApp();
    }
});

// Open cache folder
$('openCacheFolder').addEventListener('click', async () => {
    await window.prefsApi.openCacheFolder();
});

// Clear cache
$('clearCache').addEventListener('click', async () => {
    if (confirm('This will delete all downloaded models. They will be re-downloaded on next startup. Continue?')) {
        const result = await window.prefsApi.clearCache();
        if (result.success) {
            alert(`Cleared ${result.freedMB} MB of cached models.`);
        } else {
            alert('Failed to clear cache: ' + result.error);
        }
    }
});

// Initialize
loadSettings();
