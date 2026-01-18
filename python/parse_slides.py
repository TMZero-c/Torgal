import fitz # PyMuPDF
import sys
import json

def test_parse(file_path):
    try:
        doc = fitz.open(file_path)
        # Just return basic info for testing
        result = {
            "status": "success",
            "pages": len(doc),
            "first_line": doc[0].get_text().split('\n')[0] if len(doc) > 0 else "Empty"
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_parse(sys.argv[1])