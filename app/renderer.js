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
    audioCtx = new AudioContext({ sampleRate: 16000 });
    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = e => {
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
        }
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

            const conf = Math.round((msg.confidence ?? 0) * 100);
            const confBar = $('conf-bar');
            if (confBar) confBar.style.width = conf + '%';
            
            const confText = $('conf-text');
            if (confText) confText.textContent = `Confidence: ${conf}%`;
            
            const intentLabel = $('intent-label');
            if (intentLabel) intentLabel.textContent = msg.intent ?? 'Slide Transition';
            
            const intentType = $('intent-type');
            if (intentType) intentType.textContent = msg.intent_type ?? '—';

            if (conf > 0) {
                stats.totalConf += conf;
                stats.count++;
                stats.matched++;
                const totalConf = $('total-conf');
                if (totalConf) totalConf.textContent = Math.round(stats.totalConf / stats.count) + '%';
                
                const slidesMatched = $('slides-matched');
                if (slidesMatched) slidesMatched.textContent = stats.matched;
            }

            if (msg.keywords?.length) {
                const keywordsContainer = $('keywords-container');
                if (keywordsContainer) {
                    keywordsContainer.innerHTML = msg.keywords.map(kw =>
                        `<span class="keyword-tag">${kw}</span>`
                    ).join('');
                }
            }
        }
    });
}

window.addEventListener('DOMContentLoaded', bindUi);
// showHighlightOnCanvas(data.highlight_keyword);