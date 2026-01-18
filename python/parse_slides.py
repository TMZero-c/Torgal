import fitz # PyMuPDF
import sys
import json
import base64
from io import BytesIO

def parse_slides(file_path):
    try:
        doc = fitz.open(file_path)
        slides = []
        
        for i, page in enumerate(doc):
            # Render page to image
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x zoom for better quality
            image_bytes = pix.tobytes("png")
            image_base64 = base64.b64encode(image_bytes).decode('utf-8')
            
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
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        parse_slides(sys.argv[1])