const $ = id => document.getElementById(id);

let slides = [];
let current = 0;
let listening = false;
let audioCtx;
let processor;
let source;
let stream;

const log = (tag, msg) => console.log(`[renderer] [${tag}] ${msg}`);

function showSlide(i) {
    if (!slides.length) return;
    log('UI', `Showing slide ${i + 1}`);
    current = i;
    $('slide-image').src = slides[i].image;
    $('slide-counter').textContent = `${i + 1} / ${slides.length}`;
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
    $('btn').textContent = 'Stop';
    $('btn').className = 'on';
    $('status').textContent = 'Listening';
}

function stop() {
    log('AUDIO', 'Stopping microphone');
    processor?.disconnect();
    source?.disconnect();
    audioCtx?.close();
    stream?.getTracks().forEach(t => t.stop());
    listening = false;
    $('btn').textContent = 'Start';
    $('btn').className = '';
    $('status').textContent = 'Stopped';
    window.api.reset();
}

function bindUi() {
    $('upload-btn').onclick = async () => {
        log('UPLOAD', 'Opening file dialog...');
        const path = await window.api.openFileDialog();
        if (path) {
            log('UPLOAD', `File selected: ${path}`);
            $('file-status').textContent = 'Loading...';
        }
    };

    $('prev-btn').onclick = () => current > 0 && showSlide(current - 1);
    $('next-btn').onclick = () => current < slides.length - 1 && showSlide(current + 1);
    $('btn').onclick = () => listening ? stop() : start();

    window.api.onSlidesLoaded(data => {
        log('SLIDES', `Received slides-loaded event: ${data.status}`);
        if (data.status === 'success') {
            log('SLIDES', `Got ${data.total_pages} slides with images`);
            slides = data.slides;
            showSlide(0);
            $('slide-viewer').style.display = 'block';
            $('file-status').textContent = `${data.total_pages} slides`;
            $('status').textContent = 'Ready';
        } else {
            log('SLIDES', `Error: ${data.message}`);
            $('file-status').textContent = 'Error';
        }
    });

    window.api.onTranscript(msg => {
        log('MSG', `${msg.type}${msg.text ? ': ' + msg.text.substring(0, 30) : ''}`);
        if (msg.type === 'ready') $('status').textContent = 'Ready';
        else if (msg.type === 'final') {
            $('transcript').textContent += msg.text + ' ';
            $('transcript').scrollTop = $('transcript').scrollHeight;
        }
        else if (msg.type === 'partial') $('partial').textContent = msg.text;
        else if (msg.type === 'slide_transition') {
            log('TRANSITION', `Slide ${msg.from_slide + 1} → ${msg.to_slide + 1} (${msg.confidence.toFixed(2)})`);
            showSlide(msg.to_slide);
            $('info').className = 'triggered';
            $('info').textContent = `→ ${msg.to_slide + 1}: ${msg.slide_title}`;
            setTimeout(() => $('info').className = '', 800);
        }
        else if (msg.type === 'slides_ready') {
            log('SLIDES', `Server loaded ${msg.count} slides for matching`);
        }
        else if (msg.type === 'reset_done') {
            log('RESET', 'Transcript cleared');
            showSlide(0);
            $('transcript').textContent = '';
            $('info').textContent = '—';
        }
    });
}

window.addEventListener('DOMContentLoaded', bindUi); window.electronAPI.onTranscriptionResult((event, data) => {
    if (data.type === 'SLIDE_CHANGE') {
        goToSlide(data.target_slide);

        if (data.highlight_keyword) {
            showHighlightOnCanvas(data.highlight_keyword);
        }
    }
}); 
