const $ = id => document.getElementById(id);

// Audio pipeline tuning (from app/config.js)
const appConfig = window.APP_CONFIG ?? {};
const AUDIO_SAMPLE_RATE = appConfig.audioSampleRate ?? 16000;
const AUDIO_CHUNK_SIZE = appConfig.audioChunkSize ?? 2048; // Smaller = lower latency, higher CPU
const SILENCE_RMS_THRESHOLD = appConfig.silenceRmsThreshold ?? 0.012; // Lower = more sensitive
const SILENCE_SMOOTHING = appConfig.silenceSmoothing ?? 0.8; // 0..1 smoothing factor

let slides = [];
let current = 0;
let listening = false;
let audioCtx;
let processor;
let source;
let stream;
let stats = { totalConf: 0, count: 0, matched: 0 };
let lastRms = 0;

const log = (tag, msg) => console.log(`[renderer] [${tag}] ${msg}`);

function showSlide(i) {
    if (!slides.length) return;
    log('UI', `Showing slide ${i + 1}`);
    current = Math.max(0, Math.min(i, slides.length - 1));

    const previewImg = $('preview-img');
    if (previewImg) previewImg.src = slides[current].image;

    const slideNumber = $('slide-number');
    if (slideNumber) slideNumber.textContent = `${current + 1} / ${slides.length}`;

    const currentSlideNum = $('current-slide-num');
    if (currentSlideNum) currentSlideNum.textContent = current + 1;

    // Update active thumbnail
    document.querySelectorAll('.thumbnail').forEach((thumb, idx) => {
        if (idx === current) {
            thumb.classList.add('active');
        } else {
            thumb.classList.remove('active');
        }
    });
}

async function start() {
    log('AUDIO', 'Starting microphone capture...');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Match server sample rate to avoid resampling overhead.
    audioCtx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    source = audioCtx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but low-latency and simple here.
    // 2048 frames at 16kHz ≈ 128ms chunks.
    processor = audioCtx.createScriptProcessor(AUDIO_CHUNK_SIZE, 1, 1);
    processor.onaudioprocess = e => {
        const f32 = e.inputBuffer.getChannelData(0);
        // Compute RMS for basic silence detection.
        let sum = 0;
        for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
        const rms = Math.sqrt(sum / f32.length);
        // Smooth RMS to avoid jitter in silent/voiced decisions.
        lastRms = lastRms * SILENCE_SMOOTHING + rms * (1 - SILENCE_SMOOTHING);

        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
        }
        // Base64 encode PCM16 for IPC to main process.
        window.api.sendAudioChunk({
            data: btoa(String.fromCharCode(...new Uint8Array(i16.buffer))),
            rms: Number(lastRms.toFixed(4)),
            silent: lastRms < SILENCE_RMS_THRESHOLD
        });
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);
    listening = true;
    log('AUDIO', 'Microphone active, streaming to Python');
}

function stop() {
    log('AUDIO', 'Stopping microphone');
    processor?.disconnect();
    source?.disconnect();
    audioCtx?.close();
    stream?.getTracks().forEach(t => t.stop());
    listening = false;
    window.api.reset();
}

function resetStats() {
    stats = { totalConf: 0, count: 0, matched: 0 };
    const totalConf = $('total-conf');
    if (totalConf) totalConf.textContent = '0%';
    const slidesMatched = $('slides-matched');
    if (slidesMatched) slidesMatched.textContent = '0';
    const transcriptFinal = $('transcript-final');
    if (transcriptFinal) transcriptFinal.innerHTML = '';
    const transcriptPartial = $('transcript-partial');
    if (transcriptPartial) transcriptPartial.textContent = 'Listening...';
    const intentLabel = $('intent-label');
    if (intentLabel) intentLabel.textContent = 'Listening...';
    const decisionIntent = $('decision-intent');
    if (decisionIntent) decisionIntent.textContent = '—';
    const decisionStatus = $('decision-status');
    if (decisionStatus) decisionStatus.textContent = '—';
    const decisionConfidence = $('decision-confidence');
    if (decisionConfidence) decisionConfidence.textContent = '—';
    const decisionThreshold = $('decision-threshold');
    if (decisionThreshold) decisionThreshold.textContent = '—';
    const decisionDiff = $('decision-diff');
    if (decisionDiff) decisionDiff.textContent = '—';

    const labelDefaults = {
        prev: 'Prev',
        current: 'Current',
        next: 'Next',
    };

    ['prev', 'current', 'next'].forEach(key => {
        const row = $(`option-${key}-row`);
        if (row) row.classList.remove('option-best');
        const label = $(`option-${key}-label`);
        if (label) label.textContent = labelDefaults[key];
        const fill = $(`option-${key}-fill`);
        if (fill) fill.style.width = '0%';
        const value = $(`option-${key}-value`);
        if (value) value.textContent = '0%';
        const threshold = $(`option-${key}-threshold`);
        if (threshold) threshold.style.left = '0%';
    });

    const keywordsImpact = $('keywords-impact-container');
    if (keywordsImpact) keywordsImpact.innerHTML = '<span class="stat-detail">Waiting for phrase...</span>';
}

function clampPct(value) {
    return Math.max(0, Math.min(100, value));
}

function formatIntentLabel(msg) {
    const targetSlide = Number.isFinite(msg.target_slide) ? msg.target_slide + 1 : null;
    if (msg.intent === 'forward') return targetSlide ? `Forward -> Slide ${targetSlide}` : 'Forward';
    if (msg.intent === 'backward') return targetSlide ? `Backward -> Slide ${targetSlide}` : 'Backward';
    if (msg.intent === 'jump') return targetSlide ? `Jump -> Slide ${targetSlide}` : 'Jump';
    return 'Stay';
}

function updateKeywords(phrases) {
    const keywordsImpact = $('keywords-impact-container');
    if (!keywordsImpact) return;
    if (Array.isArray(phrases) && phrases.length) {
        const phrase = phrases[0];
        keywordsImpact.innerHTML = `<span class="keywords-impact-tag">${phrase}</span>`;
        return;
    }
    if (typeof phrases === 'string' && phrases.trim()) {
        keywordsImpact.innerHTML = `<span class="keywords-impact-tag">${phrases}</span>`;
        return;
    }
    keywordsImpact.innerHTML = '<span class="stat-detail">No phrase matched</span>';
}

function appendTranscriptLine(text) {
    const final = $('transcript-final');
    if (!final || !text) return;
    const cleaned = String(text).replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    final.textContent += (final.textContent ? ' ' : '') + cleaned;

    const panel = $('transcript-panel');
    if (panel) panel.scrollTop = panel.scrollHeight;
}

function updateDecisionSnapshot(msg) {
    const targetPct = clampPct(Math.round((msg.target_sim ?? 0) * 100));
    const thresholdPct = clampPct(Math.round((msg.threshold ?? 0) * 100));
    const diffPct = Math.round((msg.diff ?? 0) * 100);
    const reqDiffPct = Math.round((msg.required_diff ?? 0) * 100);
    const bestPct = clampPct(Math.round((msg.best_sim ?? 0) * 100));

    const thresholdText = `Threshold: ${thresholdPct}%`;
    const diffSign = diffPct > 0 ? '+' : '';
    const diffText = `Diff: ${diffSign}${diffPct}% (req ${reqDiffPct}%)`;

    const intentLabel = formatIntentLabel(msg);
    const actionText = msg.cooldown_blocked
        ? 'Cooldown'
        : msg.would_transition
            ? 'Will act'
            : 'No action';

    const decisionIntent = $('decision-intent');
    if (decisionIntent) decisionIntent.textContent = intentLabel;
    const decisionStatus = $('decision-status');
    if (decisionStatus) decisionStatus.textContent = actionText;
    const decisionConfidence = $('decision-confidence');
    if (decisionConfidence) decisionConfidence.textContent = `${targetPct}%`;
    const decisionThreshold = $('decision-threshold');
    if (decisionThreshold) decisionThreshold.textContent = `${thresholdPct}%`;
    const decisionDiff = $('decision-diff');
    if (decisionDiff) decisionDiff.textContent = diffText;

    const intentLabelEl = $('intent-label');
    if (intentLabelEl) intentLabelEl.textContent = intentLabel;

    const phrases = Array.isArray(msg.phrases) && msg.phrases.length
        ? msg.phrases
        : msg.keywords;
    updateKeywords(phrases);

    const slotKeys = ['prev', 'current', 'next'];
    const options = Array.isArray(msg.options) && msg.options.length
        ? msg.options.slice(0, slotKeys.length)
        : [
            { label: 'Prev', sim: msg.prev_sim, slide: msg.prev_slide },
            { label: 'Current', sim: msg.current_sim, slide: msg.current_slide },
            { label: 'Next', sim: msg.next_sim, slide: msg.next_slide },
        ];

    const optionPercents = options.map(opt => clampPct(Math.round((opt.sim ?? 0) * 100)));
    const maxPercent = optionPercents.length ? Math.max(...optionPercents) : 0;

    options.forEach((opt, idx) => {
        const key = slotKeys[idx];
        if (!key) return;
        const pct = optionPercents[idx] ?? 0;
        const row = $(`option-${key}-row`);
        if (row) row.classList.toggle('option-best', pct === maxPercent);
        const label = $(`option-${key}-label`);
        if (label) {
            const text = opt.label ?? label.textContent;
            label.textContent = text;
            label.title = text;
        }
        const fill = $(`option-${key}-fill`);
        if (fill) fill.style.width = `${pct}%`;
        const value = $(`option-${key}-value`);
        if (value) value.textContent = `${pct}%`;
        const threshold = $(`option-${key}-threshold`);
        if (threshold) threshold.style.left = `${thresholdPct}%`;
    });
}

function generateThumbnails() {
    const grid = $('thumbnails-grid');
    grid.innerHTML = '';
    slides.forEach((slide, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail' + (idx === current ? ' active' : '');
        thumb.innerHTML = `
            <img src="${slide.image}" alt="Slide ${idx + 1}">
            <div class="thumbnail-number">${idx + 1}</div>
        `;
        thumb.onclick = () => showSlide(idx);
        grid.appendChild(thumb);
    });
}

function bindUi() {
    const uploadBtn = $('upload-btn');
    const resetBtn = $('reset-btn');
    const qaModeToggle = $('qa-mode-toggle');

    if (!uploadBtn) {
        console.error('[ERROR] upload-btn not found in DOM');
        return;
    }

    uploadBtn.onclick = async () => {
        log('UPLOAD', 'Opening file dialog...');
        try {
            const result = await window.api.openFileDialog();
            log('UPLOAD', `Result: ${result}`);
        } catch (err) {
            log('UPLOAD', `Error: ${err.message}`);
        }
    };

    if (resetBtn) {
        resetBtn.onclick = () => {
            stop();
            resetStats();
        };
    }

    // Q&A Mode Toggle
    if (qaModeToggle) {
        qaModeToggle.onchange = () => {
            const isQaMode = qaModeToggle.checked;
            const modeText = $('mode-text');
            if (modeText) modeText.textContent = isQaMode ? 'Q&A' : 'Regular';

            log('MODE', `Switched to ${isQaMode ? 'Q&A' : 'Regular'} mode`);
            window.api.setQaMode(isQaMode);
        };
    }

    const prevBtn = $('prev-btn');
    const nextBtn = $('next-btn');

    if (prevBtn) prevBtn.onclick = () => { if (current > 0) showSlide(current - 1); };
    if (nextBtn) nextBtn.onclick = () => { if (current < slides.length - 1) showSlide(current + 1); };

    window.api.onSlidesLoaded(data => {
        log('SLIDES', `Received slides-loaded event: ${data.status}`);
        if (data.status === 'success') {
            log('SLIDES', `Got ${data.total_pages} slides with images`);
            slides = data.slides;
            showSlide(0);
            if ($('thumbnails-grid')) generateThumbnails();
            const totalSlides = $('total-slides');
            if (totalSlides) totalSlides.textContent = slides.length;

            // Hide placeholder
            const placeholder = $('placeholder');
            if (placeholder) placeholder.classList.add('hidden');

            if ($('upload-btn')) start(); // Auto-start listening when slides load
        }
    });

    window.api.onTranscript(msg => {
        log('MSG', `${msg.type}${msg.text ? ': ' + msg.text.substring(0, 30) : ''}`);

        if (msg.type === 'partial') {
            const transcriptPartial = $('transcript-partial');
            if (transcriptPartial) transcriptPartial.textContent = msg.text || 'Listening...';
        } else if (msg.type === 'final') {
            appendTranscriptLine(msg.text);
            const transcriptPartial = $('transcript-partial');
            if (transcriptPartial) transcriptPartial.textContent = 'Listening...';
        } else if (msg.type === 'match_eval') {
            updateDecisionSnapshot(msg);
        } else if (msg.type === 'slide_transition' || msg.type === 'slide_set') {
            const idx = msg.to_slide ?? msg.current_slide ?? 0;
            showSlide(idx);

            const intentLabel = $('intent-label');
            if (intentLabel) intentLabel.textContent = msg.intent ?? 'Slide Transition';

            const intentType = $('intent-type');
            if (intentType) intentType.textContent = msg.intent_type ?? '—';

            const conf = Math.round((msg.confidence ?? 0) * 100);
            if (conf > 0) {
                // Track running average for UI feedback.
                stats.totalConf += conf;
                stats.count++;
                stats.matched++;
                const totalConf = $('total-conf');
                if (totalConf) totalConf.textContent = Math.round(stats.totalConf / stats.count) + '%';

                const slidesMatched = $('slides-matched');
                if (slidesMatched) slidesMatched.textContent = stats.matched;
            }

            const phrases = Array.isArray(msg.phrases) && msg.phrases.length
                ? msg.phrases
                : msg.keywords;
            if (phrases?.length) {
                updateKeywords(phrases);
            }
        }
    });
}

window.addEventListener('DOMContentLoaded', bindUi);
// showHighlightOnCanvas(data.highlight_keyword);