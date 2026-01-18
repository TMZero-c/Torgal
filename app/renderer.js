window.electronAPI.onTranscriptionResult((event, data) => {
    if (data.type === 'SLIDE_CHANGE') {
        goToSlide(data.target_slide);
        
        if (data.highlight_keyword) {
            showHighlightOnCanvas(data.highlight_keyword);
        }
    }
}); 
