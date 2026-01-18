const $ = id => document.getElementById(id);

let slides = [];
let current = 0;
let listening = false;
let audioCtx;
let processor;
let source;
let stream;
let stats = { totalConf: 0, count: 0, matched: 0 };

const log = (tag, msg) => console.log(`[renderer] [${tag}] ${msg}`);

function showSlide(i) {
    if (!slides.length) return;
    log('UI', `Showing slide ${i + 1}`);
    current = Math.max(0, Math.min(i, slides.length - 1));
    $('preview-img').src = slides[current].image;
    $('slide-number').textContent = `${current + 1} / ${slides.length}`;
    $('current-slide-num').textContent = current + 1;
}

async function start() {
    log('AUDIO', 'Starting microphone capture...');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Match server sample rate to avoid resampling overhead.
    audioCtx = new AudioContext({ sampleRate: 16000 });
    source = audioCtx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but low-latency and simple here.
    // 4096 frames at 16kHz ≈ 256ms chunks.
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = e => {
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
        }
        // Base64 encode PCM16 for IPC to main process.
        window.api.sendAudioChunk(btoa(String.fromCharCode(...new Uint8Array(i16.buffer))));
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
    $('conf-bar').style.width = '0%';
    $('conf-text').textContent = 'Confidence: 0%';
}

function bindUi() {
    $('upload-btn').onclick = async () => {
        log('UPLOAD', 'Opening file dialog...');
        await window.api.openFileDialog();
    };

    $('reset-btn').onclick = () => {
        stop();
        resetStats();
    };

    $('prev-btn').onclick = () => { if (current > 0) showSlide(current - 1); };
    $('next-btn').onclick = () => { if (current < slides.length - 1) showSlide(current + 1); };

    window.api.onSlidesLoaded(data => {
        log('SLIDES', `Received slides-loaded event: ${data.status}`);
        if (data.status === 'success') {
            log('SLIDES', `Got ${data.total_pages} slides with images`);
            slides = data.slides;
            showSlide(0);
            $('total-slides').textContent = slides.length;
            // Auto-start listening when slides load (fast setup flow).
            start();
        }
    });

    window.api.onTranscript(msg => {
        log('MSG', `${msg.type}${msg.text ? ': ' + msg.text.substring(0, 30) : ''}`);

        if (msg.type === 'partial') {
            $('transcript-partial').textContent = msg.text;
        } else if (msg.type === 'final') {
            const final = $('transcript-final');
            final.textContent += (final.textContent ? '\n' : '') + msg.text;
            $('transcript-partial').textContent = '';
        } else if (msg.type === 'slide_transition' || msg.type === 'slide_set') {
            const idx = msg.to_slide ?? msg.current_slide ?? 0;
            showSlide(idx);

            const conf = Math.round((msg.confidence ?? 0) * 100);
            $('conf-bar').style.width = conf + '%';
            $('conf-text').textContent = `Confidence: ${conf}%`;
            $('intent-label').textContent = msg.intent ?? 'Slide Transition';
            $('intent-type').textContent = msg.intent_type ?? '—';

            if (conf > 0) {
                // Track running average for UI feedback.
                stats.totalConf += conf;
                stats.count++;
                stats.matched++;
                $('total-conf').textContent = Math.round(stats.totalConf / stats.count) + '%';
                $('slides-matched').textContent = stats.matched;
            }

            if (msg.keywords?.length) {
                $('keywords-container').innerHTML = msg.keywords.map(kw =>
                    `<span class="keyword-tag">${kw}</span>`
                ).join('');
            }
        }
    });
}

window.addEventListener('DOMContentLoaded', bindUi);
showHighlightOnCanvas(data.highlight_keyword);