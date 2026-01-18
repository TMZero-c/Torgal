import fitz  # PyMuPDF
import json
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')

def process_presentation(pdf_path):
    doc = fitz.open(pdf_path)
    presentation_data = []

    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        
        # 1. Capture the text for AI matching
        text = page.get_text("text")
        
        # 2. Get word coordinates for the "Highlight" feature
        # This returns a list of (x0, y0, x1, y1, "word", block_no, line_no, word_no)
        words = page.get_text("words") 

        # 3. Create a vector embedding of the slide text
        embedding = model.encode(text).tolist() # type: ignore

        presentation_data.append({
            "slide": page_num + 1,
            "text": text,
            "embedding": embedding,
            "words": words 
        })
        
        # 4. Optional: Save a thumbnail for the Electron UI
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2)) # 2x zoom for clarity
        pix.save(f"slide_{page_num}.png")

    return presentation_data