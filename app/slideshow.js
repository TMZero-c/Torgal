// Slideshow window renderer (display-only, follows transitions)
let slides = [];
let currentIndex = 0;

const display = document.getElementById('display');
const slideInfo = document.getElementById('slide-info');

// Set initial placeholder image
display.src = 'assets/no-presentation.svg';
display.alt = 'No presentation loaded';

function showSlide(index) {
    if (slides.length && index >= 0 && index < slides.length) {
        currentIndex = index;
        display.src = slides[index].image;
        display.alt = `Slide ${index + 1}`;
        slideInfo.textContent = `${index + 1} / ${slides.length}`;
    }
}

window.api.onSlidesLoaded((data) => {
    // Initialize slideshow once slides are parsed.
    if (data.status === 'success' && data.slides?.length) {
        slides = data.slides;
        showSlide(0);
    } else {
        // Show placeholder on failure or no slides
        display.src = 'assets/no-presentation.svg';
        display.alt = 'No presentation loaded';
        slideInfo.textContent = '—';
    }
});

window.api.onTranscript((msg) => {
    // Follow transitions coming from the Python matcher.
    if (msg.type === 'slide_transition' || msg.type === 'slide_set') {
        const idx = msg.to_slide ?? msg.current_slide ?? 0;
        if (idx !== currentIndex) showSlide(idx);
    }
});
// Keyboard navigation: arrow keys to move slides
document.addEventListener('keydown', (e) => {
    if (slides.length === 0) return;

    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentIndex > 0) showSlide(currentIndex - 1);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentIndex < slides.length - 1) showSlide(currentIndex + 1);
    }
});