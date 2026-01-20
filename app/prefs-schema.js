/**
 * Preferences Schema
 * 
 * Defines all settings, their types, defaults, and UI configuration.
 * preferences.js uses this schema to dynamically generate the form.
 */

const PREFS_SCHEMA = {
    // ==========================================================================
    // Audio Tab
    // ==========================================================================
    audio: {
        label: 'Audio',
        sections: [
            {
                title: 'Capture Settings',
                fields: [
                    {
                        id: 'audioSampleRate',
                        label: 'Sample Rate',
                        type: 'select',
                        default: 16000,
                        options: [
                            { value: 16000, label: '16000 Hz (recommended)' },
                            { value: 22050, label: '22050 Hz' },
                            { value: 44100, label: '44100 Hz' },
                        ],
                        help: 'Lower = less CPU, 16kHz is optimal for Whisper',
                    },
                    {
                        id: 'audioChunkSize',
                        label: 'Chunk Size',
                        type: 'select',
                        default: 1024,
                        options: [
                            { value: 512, label: '512 samples' },
                            { value: 1024, label: '1024 samples (recommended)' },
                            { value: 2048, label: '2048 samples' },
                            { value: 4096, label: '4096 samples' },
                        ],
                        help: 'Smaller = more responsive, higher CPU',
                    },
                ],
            },
            {
                title: 'Silence Detection',
                fields: [
                    {
                        id: 'silenceRmsThreshold',
                        label: 'RMS Threshold',
                        type: 'number',
                        default: 0.01,
                        min: 0.001,
                        max: 0.1,
                        step: 0.001,
                        help: 'Below this level is considered silence',
                    },
                    {
                        id: 'silenceSmoothing',
                        label: 'Smoothing Factor',
                        type: 'number',
                        default: 0.7,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        help: 'Higher = more stable silence detection',
                    },
                    {
                        id: 'audioBufferSeconds',
                        label: 'Audio Buffer (seconds)',
                        type: 'number',
                        default: 8,
                        min: 2,
                        max: 30,
                        step: 1,
                        help: 'Longer = more context, higher latency',
                    },
                ],
            },
        ],
    },

    // ==========================================================================
    // Matching Tab
    // ==========================================================================
    matching: {
        label: 'Matching',
        sections: [
            {
                title: 'Match Thresholds',
                fields: [
                    {
                        id: 'matchThreshold',
                        label: 'Match Threshold',
                        type: 'number',
                        default: 0.55,
                        min: 0,
                        max: 1,
                        step: 0.01,
                        help: 'Minimum similarity to trigger slide change',
                    },
                    {
                        id: 'matchCooldownWords',
                        label: 'Cooldown Words',
                        type: 'number',
                        default: 4,
                        min: 1,
                        max: 20,
                        step: 1,
                        help: 'Words to wait between slide transitions',
                    },
                    {
                        id: 'matchDiff',
                        label: 'Match Difference',
                        type: 'number',
                        default: 0.09,
                        min: 0,
                        max: 0.5,
                        step: 0.01,
                        help: 'Required gap between current and new slide score',
                    },
                    {
                        id: 'windowWords',
                        label: 'Window Words',
                        type: 'number',
                        default: 14,
                        min: 5,
                        max: 40,
                        step: 1,
                        help: 'Number of words to consider for matching',
                    },
                ],
            },
            {
                title: 'Slide Bias',
                fields: [
                    {
                        id: 'stayBiasMargin',
                        label: 'Stay Bias',
                        type: 'number',
                        default: 0.02,
                        min: 0,
                        max: 0.2,
                        step: 0.01,
                        help: 'Extra margin to stay on current slide',
                    },
                    {
                        id: 'forwardBiasMargin',
                        label: 'Forward Bias',
                        type: 'number',
                        default: 0.06,
                        min: 0,
                        max: 0.2,
                        step: 0.01,
                        help: 'Preference for next slide',
                    },
                    {
                        id: 'backBiasMargin',
                        label: 'Back Bias',
                        type: 'number',
                        default: 0.02,
                        min: 0,
                        max: 0.2,
                        step: 0.01,
                        help: 'Preference for previous slide',
                    },
                ],
            },
        ],
    },

    // ==========================================================================
    // Models Tab
    // ==========================================================================
    models: {
        label: 'Models',
        sections: [
            {
                title: 'Whisper (Speech Recognition)',
                fields: [
                    {
                        id: 'whisperModel',
                        label: 'Model',
                        type: 'select',
                        default: 'distil-large-v3.5',
                        optgroups: [
                            {
                                label: 'Distilled (recommended)',
                                options: [
                                    { value: 'distil-large-v3.5', label: 'distil-large-v3.5 (~1.5 GB) - Best accuracy ★' },
                                    { value: 'distil-medium.en', label: 'distil-medium.en (~750 MB) - Faster, English only' },
                                    { value: 'distil-small.en', label: 'distil-small.en (~500 MB) - Fast, lower accuracy' },
                                ],
                            },
                            {
                                label: 'Original (slower)',
                                options: [
                                    { value: 'large-v3', label: 'large-v3 (~2.9 GB) - Highest accuracy' },
                                    { value: 'medium.en', label: 'medium.en (~1.5 GB) - Good, English only' },
                                    { value: 'small.en', label: 'small.en (~500 MB) - Fast, English only' },
                                    { value: 'tiny.en', label: 'tiny.en (~150 MB) - Fastest, lowest accuracy' },
                                ],
                            },
                        ],
                        help: 'Distilled models offer best speed/accuracy tradeoff',
                    },
                    {
                        id: 'whisperBeamSize',
                        label: 'Beam Size',
                        type: 'select',
                        default: 1,
                        options: [
                            { value: 1, label: '1 - Fastest (greedy)' },
                            { value: 2, label: '2 - Fast + slightly better' },
                            { value: 3, label: '3 - Balanced' },
                            { value: 5, label: '5 - More accurate, slower' },
                        ],
                        help: 'Higher beam size improves accuracy for small models',
                    },
                    {
                        id: 'whisperDevice',
                        label: 'Compute Device',
                        type: 'select',
                        default: 'cuda',
                        options: [
                            { value: 'cuda', label: 'CUDA (NVIDIA GPU) - Recommended' },
                            { value: 'cpu', label: 'CPU - Slower, works everywhere' },
                        ],
                        gpuOnly: ['cuda'],
                    },
                    {
                        id: 'whisperComputeType',
                        label: 'Compute Type',
                        type: 'select',
                        default: 'float16',
                        options: [
                            { value: 'float16', label: 'float16 - GPU default, fast', gpuOnly: true },
                            { value: 'int8_float16', label: 'int8_float16 - GPU, faster', gpuOnly: true },
                            { value: 'float32', label: 'float32 - Most accurate, slowest' },
                            { value: 'int8', label: 'int8 - CPU optimized' },
                        ],
                        help: 'Use int8 for CPU, float16 for GPU',
                    },
                ],
            },
            {
                title: 'Embedding Model (Semantic Matching)',
                fields: [
                    {
                        id: 'embeddingModel',
                        label: 'Model',
                        type: 'select',
                        default: 'BAAI/bge-base-en-v1.5',
                        optgroups: [
                            {
                                label: 'Fast (recommended for CPU)',
                                options: [
                                    { value: 'sentence-transformers/all-MiniLM-L6-v2', label: 'all-MiniLM-L6-v2 (~90 MB) - Fastest' },
                                    { value: 'sentence-transformers/paraphrase-MiniLM-L3-v2', label: 'paraphrase-MiniLM-L3-v2 (~60 MB) - Tiny' },
                                ],
                            },
                            {
                                label: 'Balanced',
                                options: [
                                    { value: 'BAAI/bge-small-en-v1.5', label: 'bge-small-en (~130 MB) - Good quality' },
                                    { value: 'sentence-transformers/all-mpnet-base-v2', label: 'all-mpnet-base-v2 (~420 MB) - High quality' },
                                ],
                            },
                            {
                                label: 'High Quality (GPU recommended)',
                                options: [
                                    { value: 'BAAI/bge-base-en-v1.5', label: 'bge-base-en (~440 MB) - Very good ★' },
                                    { value: 'BAAI/bge-large-en-v1.5', label: 'bge-large-en (~1.3 GB) - Best quality' },
                                ],
                            },
                        ],
                        help: 'Larger = better semantic matching, more memory',
                    },
                    {
                        id: 'embeddingDevice',
                        label: 'Compute Device',
                        type: 'select',
                        default: 'auto',
                        options: [
                            { value: 'auto', label: 'Auto (use GPU if available)' },
                            { value: 'cuda', label: 'CUDA (NVIDIA GPU)', gpuOnly: true },
                            { value: 'cpu', label: 'CPU' },
                        ],
                        help: 'GPU dramatically speeds up embedding computation',
                    },
                    {
                        id: 'sentenceEmbeddingsEnabled',
                        label: 'Enable sentence embeddings',
                        type: 'checkbox',
                        default: true,
                        help: 'More accurate for bullet points, higher CPU/GPU usage',
                    },
                ],
            },
            {
                title: 'Transcription Filtering',
                help: 'Controls how garbage/hallucinated words are filtered',
                fields: [
                    {
                        id: 'filterMinWordLen',
                        label: 'Min Word Length',
                        type: 'number',
                        default: 2,
                        min: 1,
                        max: 5,
                        step: 1,
                        help: 'Minimum characters for a word (except I and a)',
                    },
                    {
                        id: 'fuzzyMatchMinLen',
                        label: 'Fuzzy Match Min Length',
                        type: 'number',
                        default: 4,
                        min: 3,
                        max: 8,
                        step: 1,
                        help: 'Min word length for fuzzy matching',
                    },
                    {
                        id: 'filterDedupe',
                        label: 'Remove consecutive duplicates',
                        type: 'checkbox',
                        default: true,
                        help: 'Filter repeated words like "the the the"',
                    },
                    {
                        id: 'filterPunctuation',
                        label: 'Filter punctuation-only tokens',
                        type: 'checkbox',
                        default: true,
                        help: 'Remove tokens like ".", "-", "..."',
                    },
                    {
                        id: 'whisperBatchBeamSize',
                        label: 'Batch Mode Beam Size',
                        type: 'select',
                        default: 3,
                        options: [
                            { value: 3, label: '3 - Default for batch' },
                            { value: 5, label: '5 - More accurate' },
                            { value: 7, label: '7 - Highest accuracy' },
                        ],
                        help: 'Beam size used when batch audio mode is enabled',
                    },
                ],
            },
            {
                title: 'Model Cache',
                custom: 'modelCache',  // Rendered by custom handler
            },
        ],
    },

    // ==========================================================================
    // Advanced Tab
    // ==========================================================================
    advanced: {
        label: 'Advanced',
        sections: [
            {
                title: 'Voice Commands',
                fields: [
                    {
                        id: 'triggerCooldownMs',
                        label: 'Command Cooldown (ms)',
                        type: 'number',
                        default: 1500,
                        min: 500,
                        max: 5000,
                        step: 100,
                    },
                    {
                        id: 'triggerTailWords',
                        label: 'Tail Words to Check',
                        type: 'number',
                        default: 6,
                        min: 2,
                        max: 20,
                        step: 1,
                    },
                ],
            },
            {
                title: 'Partial Matching',
                fields: [
                    {
                        id: 'partialMatchEnabled',
                        label: 'Enable partial matching',
                        type: 'checkbox',
                        default: true,
                        help: 'Improves responsiveness while speaking, adds CPU load',
                    },
                    {
                        id: 'partialFinalizeMs',
                        label: 'Finalize After Silence (ms)',
                        type: 'number',
                        default: 1000,
                        min: 500,
                        max: 3000,
                        step: 100,
                    },
                    {
                        id: 'partialMatchMinWords',
                        label: 'Min Words for Partial Match',
                        type: 'number',
                        default: 5,
                        min: 2,
                        max: 15,
                        step: 1,
                    },
                ],
            },
            {
                title: 'Q&A Mode Overrides',
                fields: [
                    {
                        id: 'qaWindowWords',
                        label: 'Q&A Window Words',
                        type: 'number',
                        default: 24,
                        min: 10,
                        max: 60,
                        step: 1,
                    },
                    {
                        id: 'qaMatchThreshold',
                        label: 'Q&A Match Threshold',
                        type: 'number',
                        default: 0.60,
                        min: 0,
                        max: 1,
                        step: 0.01,
                    },
                ],
            },
            {
                title: '⚠️ Nuclear Options',
                style: 'warning',  // Special styling
                help: 'Use these only if the app is unusably slow. They significantly reduce accuracy.',
                fields: [
                    {
                        id: 'batchAudioMode',
                        label: 'Batch Audio Mode',
                        type: 'checkbox',
                        default: false,
                        help: 'Process audio in batches instead of streaming. Adds latency but reduces CPU.',
                    },
                    {
                        id: 'batchAudioIntervalMs',
                        label: 'Batch Interval (ms)',
                        type: 'number',
                        default: 3000,
                        min: 1000,
                        max: 10000,
                        step: 500,
                        help: 'Time between batch processing (higher = less CPU, more delay)',
                    },
                    {
                        id: 'keywordOnlyMatching',
                        label: 'Keyword-Only Matching',
                        type: 'checkbox',
                        default: false,
                        help: 'Skip AI embeddings, use only keyword overlap. Much faster but less accurate.',
                    },
                ],
            },
            {
                title: 'Reset',
                custom: 'resetDefaults',
            },
        ],
    },
};

// Build DEFAULTS and FIELD_TYPES from schema
function buildFromSchema() {
    const defaults = {};
    const fieldTypes = {};

    for (const tab of Object.values(PREFS_SCHEMA)) {
        for (const section of tab.sections) {
            if (!section.fields) continue;
            for (const field of section.fields) {
                defaults[field.id] = field.default;
                fieldTypes[field.id] = field.type;
            }
        }
    }

    return { defaults, fieldTypes };
}

const { defaults: DEFAULTS, fieldTypes: FIELD_TYPES } = buildFromSchema();

// Export for use in preferences.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PREFS_SCHEMA, DEFAULTS, FIELD_TYPES };
}
