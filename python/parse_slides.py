import fitz # PyMuPDF
import sys
import json
import base64
import tempfile
import os

def parse_slides(file_path):
    try:
        doc = fitz.open(file_path)
        slides = []
        temp_dir = tempfile.gettempdir()
        
        for i, page in enumerate(doc):
            # Render page to image
            pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))  # 1.5x zoom for balance
            
            # Save to temp file and read as base64
            temp_path = os.path.join(temp_dir, f'slide_{i}.png')
            pix.save(temp_path)
            
            with open(temp_path, 'rb') as f:
                image_base64 = base64.b64encode(f.read()).decode('utf-8')
            
            os.remove(temp_path)  # Clean up temp file
            
            # Extract text
            text = page.get_text()
            
            slides.append({
                "page": i + 1,
                "image": f"data:image/png;base64,{image_base64}",
                "text": text
            })
        
        result = {
            "status": "success",
            "total_pages": len(doc),
            "slides": slides
        }
        print(json.dumps(result))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        parse_slides(sys.argv[1])