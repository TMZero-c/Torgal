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
    whisperBeamSize: 1,
    embeddingModel: 'BAAI/bge-base-en-v1.5',
    embeddingDevice: 'auto',
    sentenceEmbeddingsEnabled: true,

    // Voice commands
    triggerCooldownMs: 1500,
    triggerTailWords: 6,

    // Partial matching
    partialFinalizeMs: 1000,
    partialMatchMinWords: 5,
    partialMatchEnabled: true,

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
    whisperBeamSize: 'select',
    embeddingModel: 'select',
    embeddingDevice: 'select',
    sentenceEmbeddingsEnabled: 'checkbox',
    triggerCooldownMs: 'number',
    triggerTailWords: 'number',
    partialFinalizeMs: 'number',
    partialMatchMinWords: 'number',
    partialMatchEnabled: 'checkbox',
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
    const cudaAvailable = await window.prefsApi.getCudaAvailable();

    // Hide GPU options if CUDA is not available
    if (!cudaAvailable) {
        // Hide CUDA options in Whisper device dropdown
        const whisperDevice = $('whisperDevice');
        if (whisperDevice) {
            const cudaOption = whisperDevice.querySelector('option[value="cuda"]');
            if (cudaOption) cudaOption.style.display = 'none';
            // Force CPU if currently set to cuda
            if (currentSettings.whisperDevice === 'cuda') {
                currentSettings.whisperDevice = 'cpu';
            }
        }

        // Hide GPU compute types
        const whisperComputeType = $('whisperComputeType');
        if (whisperComputeType) {
            whisperComputeType.querySelectorAll('option').forEach(opt => {
                if (opt.value === 'float16' || opt.value === 'int8_float16') {
                    opt.style.display = 'none';
                }
            });
            // Force int8 if currently set to GPU type
            if (['float16', 'int8_float16'].includes(currentSettings.whisperComputeType)) {
                currentSettings.whisperComputeType = 'int8';
            }
        }

        // Hide CUDA option in embedding device dropdown
        const embeddingDevice = $('embeddingDevice');
        if (embeddingDevice) {
            const cudaOption = embeddingDevice.querySelector('option[value="cuda"]');
            if (cudaOption) cudaOption.style.display = 'none';
            // Force auto or cpu if currently set to cuda
            if (currentSettings.embeddingDevice === 'cuda') {
                currentSettings.embeddingDevice = 'cpu';
            }
        }

        // Add a note about GPU not being available
        const modelsTab = $('tab-models');
        if (modelsTab && !$('no-cuda-notice')) {
            const notice = document.createElement('div');
            notice.id = 'no-cuda-notice';
            notice.style.cssText = 'background: #553; padding: 10px; margin-bottom: 15px; color: #fa0; font-size: 12px;';
            notice.textContent = '⚠ CUDA not available. GPU options are hidden. Install NVIDIA GPU drivers for GPU acceleration.';
            modelsTab.insertBefore(notice, modelsTab.firstChild);
        }
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
        } else if (type === 'checkbox') {
            settings[key] = Boolean(el.checked);
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
