# Copie l'interface de l'atelier (dtg-redaction.html) dans l'application et remplace les bibliothèques en ligne par les copies locales.
import sys, re, pathlib
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "../dtg-redaction.html")
h = src.read_text(encoding="utf-8")
M = {
 "https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js": "vendor/docx.iife.js",
 "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js": "vendor/mammoth.browser.min.js",
 "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js": "vendor/html2canvas.min.js",
 "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": "vendor/jspdf.umd.min.js",
 "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js": "vendor/jszip.min.js",
 "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js": "vendor/pdf.min.js",
 "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js": "vendor/pdf.worker.min.js",
}
for a, b in M.items():
    assert a in h, "URL absente : " + a
    h = h.replace(a, b)
h = h.replace('<script src="vendor/mammoth.browser.min.js"></script>', '<script src="vendor/mammoth.browser.min.js"></script>\n<script src="vendor/jszip.min.js"></script>', 1)
h = h.replace("<title>Atelier DTG — rédaction</title>", "<title>Atelier DTG</title>")
pathlib.Path("renderer/index.html").write_text(h, encoding="utf-8")
print("renderer/index.html prêt", len(h))
