import os
import glob
import base64
import shutil
import logging
import tempfile
import subprocess
from io import BytesIO

import pandas as pd
from PIL import Image
from pdf2image import convert_from_path

from core.config import POPPLER_PATH
from services.extraction.vision import call_vision


def _find_libreoffice():
    """Chemin de LibreOffice selon l'OS, ou None s'il est absent."""
    candidates = [
        "libreoffice",
        "soffice",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ]
    for c in candidates:
        if shutil.which(c) or os.path.exists(c):
            return c
    return None


def _docx_table_to_md(table) -> str:
    rows = []
    for r_idx, row in enumerate(table.rows):
        cells = [c.text.strip().replace("\n", " ") for c in row.cells]
        rows.append("| " + " | ".join(cells) + " |")
        if r_idx == 0:
            rows.append("| " + " | ".join(["---"] * len(cells)) + " |")
    return "\n".join(rows)


def _render_docx_to_images(docx_path: str):
    """Aperçu : .docx → PDF temporaire (LibreOffice) → images. [] si LibreOffice absent."""
    try:
        lo_exe = _find_libreoffice()
        if not lo_exe:
            logging.warning("[WORD] LibreOffice introuvable — aperçu désactivé")
            return []

        out_dir = tempfile.mkdtemp(prefix="docx_preview_")
        subprocess.run(
            [lo_exe, "--headless", "--norestore", "--nolockcheck",
             "--convert-to", "pdf", "--outdir", out_dir, docx_path],
            check=True, timeout=120,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        pdfs = glob.glob(os.path.join(out_dir, "*.pdf"))
        if not pdfs:
            return []

        images = convert_from_path(pdfs[0], dpi=120, poppler_path=POPPLER_PATH)
        out = []
        for img in images:
            buf = BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=60)
            out.append(base64.b64encode(buf.getvalue()).decode("utf-8"))
        shutil.rmtree(out_dir, ignore_errors=True)
        return out
    except Exception as e:
        logging.warning(f"[WORD] Aperçu échoué ({e}) — texte seul")
        return []


def process_word_docx(file_path: str, file_name: str):
    """Extrait un .docx en Markdown, dans l'ordre d'apparition."""
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(file_path)
    body = doc.element.body
    rels = doc.part.rels

    md_parts = []
    para_iter = iter(doc.paragraphs)
    table_iter = iter(doc.tables)
    MIN_EMU = int(2.5 * 360000)   # ~2,5 cm : en dessous, image décorative

    for child in body.iterchildren():
        tag = child.tag

        if tag == qn("w:p"):
            try:
                para = next(para_iter)
            except StopIteration:
                continue
            txt = para.text.strip()
            style = (para.style.name or "").lower() if para.style else ""

            # Images du paragraphe → vision si assez grandes
            for blip in child.findall(".//" + qn("a:blip")):
                r_id = blip.get(qn("r:embed"))
                if not r_id or r_id not in rels:
                    continue
                ext = child.find(".//" + qn("wp:extent"))
                big = True
                if ext is not None:
                    try:
                        big = int(ext.get("cx")) >= MIN_EMU and int(ext.get("cy")) >= MIN_EMU
                    except Exception:
                        big = True
                if not big:
                    continue
                try:
                    img_bytes = rels[r_id].target_part.blob
                    pil = Image.open(BytesIO(img_bytes)).convert("RGB")
                    image_md = call_vision(pil, txt[:300])
                    if image_md:
                        md_parts.append(image_md)
                except Exception as e:
                    logging.warning(f"[WORD] Image ignorée ({e})")

            if not txt:
                continue
            if style.startswith("heading 1") or style.startswith("titre 1"):
                md_parts.append(f"# {txt}")
            elif style.startswith("heading 2") or style.startswith("titre 2"):
                md_parts.append(f"## {txt}")
            elif style.startswith("heading"):
                md_parts.append(f"### {txt}")
            else:
                md_parts.append(txt)

        elif tag == qn("w:tbl"):
            try:
                md_parts.append(_docx_table_to_md(next(table_iter)))
            except StopIteration:
                continue

    full_md = "\n\n".join(md_parts) if md_parts else "*(Document Word vide)*"

    return [{
        "page": 1,
        "fileName": file_name,
        "image": None,
        "images": _render_docx_to_images(file_path),
        "html": None,
        "markdown": full_md,
        "type": "word",
    }]


def process_excel(file_path: str, file_name: str):
    """Un onglet Excel = une « page »."""
    results = []
    excel_data = pd.read_excel(file_path, sheet_name=None)
    for sheet_name, df in excel_data.items():
        df = df.fillna("")
        results.append({
            "page": f"Excel: {sheet_name}",
            "fileName": file_name,
            "image": None,
            "html": df.to_html(classes="excel-table", index=False),
            "markdown": df.to_markdown(tablefmt="grid"),
            "type": "excel",
        })
    return results