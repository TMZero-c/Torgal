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
    $('total-conf').textContent = '0%';
    $('slides-matched').textContent = '0';
    $('transcript-final').textContent = '';
    $('transcript-partial').textContent = 'Listening...';
    $('intent-label').textContent = 'Listening...';
    const spectrumFill = $('spectrum-fill');
    if (spectrumFill) {
        spectrumFill.style.left = '50%';
        spectrumFill.style.width = '0%';
    }
    const spectrumText = $('spectrum-text');
    if (spectrumText) spectrumText.textContent = 'Intent: 0';
    
    const keywordsImpact = $('keywords-impact-container');
    if (keywordsImpact) keywordsImpact.innerHTML = '<span class="stat-detail">Waiting for keywords...</span>';
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
            if (transcriptPartial) transcriptPartial.textContent = msg.text;
        } else if (msg.type === 'final') {
            const final = $('transcript-final');
            if (final) final.textContent += (final.textContent ? '\n' : '') + msg.text;
            const transcriptPartial = $('transcript-partial');
            if (transcriptPartial) transcriptPartial.textContent = '';
        } else if (msg.type === 'slide_transition' || msg.type === 'slide_set') {
            const idx = msg.to_slide ?? msg.current_slide ?? 0;
            showSlide(idx);

            // Update spectrum meter based on intent direction
            // intent should be something like "go forward" or "go backward" or "stay"
            let intentValue = 0; // -1 to 1
            const intentText = msg.intent ? msg.intent.toLowerCase() : '';
            
            if (intentText.includes('backward') || intentText.includes('previous') || intentText.includes('back')) {
                intentValue = -1;
            } else if (intentText.includes('forward') || intentText.includes('next') || intentText.includes('continue')) {
                intentValue = 1;
            }
            // else intentValue stays 0 for neutral
            
            const spectrumFill = $('spectrum-fill');
            if (spectrumFill) {
                // Calculate position: -1 is at 0%, 0 is at 50%, 1 is at 100%
                const fillPercentage = ((intentValue + 1) / 2) * 100;
                const leftPosition = 50 + (intentValue * 50);
                
                spectrumFill.style.left = leftPosition + '%';
                spectrumFill.style.width = '20px';
                spectrumFill.style.marginLeft = '-10px'; // Center the fill indicator
            }
            
            const spectrumText = $('spectrum-text');
            if (spectrumText) spectrumText.textContent = `Intent: ${intentValue}`;

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

            if (msg.keywords?.length) {
                const keywordsImpact = $('keywords-impact-container');
                if (keywordsImpact) {
                    keywordsImpact.innerHTML = msg.keywords.map(kw =>
                        `<span class="keywords-impact-tag">${kw}</span>`
                    ).join('');
                }
            }
        }
    });
}

window.addEventListener('DOMContentLoaded', bindUi);
// showHighlightOnCanvas(data.highlight_keyword);