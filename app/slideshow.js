// Slideshow window renderer
let slides = [];
let currentIndex = 0;

const display = document.getElementById('display');
const slideInfo = document.getElementById('slide-info');

function showSlide(index) {
    if (slides.length && index >= 0 && index < slides.length) {
        currentIndex = index;
        display.src = slides[index].image;
        slideInfo.textContent = `${index + 1} / ${slides.length}`;
    }
}

window.api.onSlidesLoaded((data) => {
    if (data.status === 'success' && data.slides?.length) {
        slides = data.slides;
        showSlide(0);
    }
});

window.api.onTranscript((msg) => {
    if (msg.type === 'slide_transition' || msg.type === 'slide_set') {
        const idx = msg.to_slide ?? msg.current_slide ?? 0;
        if (idx !== currentIndex) showSlide(idx);
    }
});
