import gc
import uuid
import base64
import logging
from io import BytesIO

import numpy as np
from PIL import Image
from pdf2image import convert_from_path
from PyPDF2 import PdfReader, PdfWriter

from core.config import POPPLER_PATH, TEMP_DIR
from services.extraction.vision import call_vision


# ─── Docling : chargé une seule fois, à la première utilisation (~1 Go) ──────
_doc_converter = None


def get_doc_converter():
    global _doc_converter
    if _doc_converter is None:
        logging.info("Chargement de Docling (premier appel)...")
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat

        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = True
        pipeline_options.do_table_structure = True
        _doc_converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
        )
        logging.info("Docling chargé.")
    return _doc_converter


# ─── Routage page par page : Docling ou vision ───────────────────────────────
def detect_page_type(pil_image: Image.Image, digital_word_count: int):
    """
    1. Beaucoup de texte numérique (PyPDF2) → PDF natif → DOCLING
    2. Sinon, variance des pixels :
       - > 800              → image riche / scan → LVM
       - 400-800 + < 10 mots → scan probable     → LVM
       - sinon               → DOCLING
    """
    if digital_word_count > 30:
        return "DOCLING", digital_word_count

    gray = np.array(pil_image.convert("L"), dtype=np.float32)
    variance = float(np.var(gray))

    if variance > 800:
        return "LVM", 0
    if digital_word_count < 10 and variance > 400:
        return "LVM", 0
    return "DOCLING", digital_word_count


def get_page_routing_decision(pdf_reader, page_num: int, pil_image: Image.Image):
    """Retourne (decision, ocr_hint, visual_word_count)."""
    try:
        digital_text = pdf_reader.pages[page_num].extract_text() or ""
    except Exception:
        digital_text = ""

    decision, v_count = detect_page_type(pil_image, len(digital_text.split()))
    ocr_hint = digital_text[:800] if digital_text else ""
    return decision, ocr_hint, v_count


def get_optimal_dpi(pdf_reader) -> int:
    """200 DPI pour un PDF numérique, 250 pour un scan probable."""
    try:
        sample_pages = min(3, len(pdf_reader.pages))
        total_words = sum(
            len((pdf_reader.pages[i].extract_text() or "").split())
            for i in range(sample_pages)
        )
        avg_words = total_words / sample_pages
        if avg_words > 20:
            logging.info(f"PDF numérique (moy. {avg_words:.0f} mots/page) → DPI 200")
            return 200
        logging.info(f"PDF scanné probable (moy. {avg_words:.0f} mots/page) → DPI 250")
        return 250
    except Exception:
        return 200


# ─── Contrôles qualité du Markdown (filets de sécurité) ──────────────────────
def md_is_poor(md: str, digital_full: str) -> bool:
    """Markdown jugé pauvre : il a manifestement perdu du contenu."""
    cleaned = (md or "").replace("<!-- image -->", "")
    cleaned_lines = [
        ln for ln in cleaned.splitlines()
        if ln.strip() and set(ln.strip()) - set("|-: ")
    ]
    cleaned = " ".join(cleaned_lines).strip()

    md_words = len(cleaned.split())
    digital_words = len(digital_full.split())

    if md_words < 15:
        return True
    if digital_words > 50 and md_words < 0.4 * digital_words:
        return True
    return False


def md_is_garbled_table(md: str) -> bool:
    """Tableau Docling corrompu : trop de colonnes ou trop de cellules vides."""
    if not md or "|" not in md:
        return False
    max_cols = max((ln.count("|") for ln in md.splitlines()), default=0)
    empties = md.count("| |") + md.count("|  |")
    total = md.count("|") or 1
    empty_ratio = empties / total
    if max_cols > 15:
        return True
    if empty_ratio > 0.5 and max_cols > 6:
        return True
    return False


def md_is_truncated(md: str, digital_full: str) -> bool:
    """La vision a probablement sauté des lignes par rapport au texte numérique."""
    if len(digital_full.split()) < 80:
        return False
    return len((md or "").split()) < 0.75 * len(digital_full.split())


def append_digital(md: str, digital_full: str) -> str:
    """Ajoute le texte brut à la fin pour qu'aucune ligne ne soit perdue."""
    if len(digital_full.split()) < 30:
        return md
    return (
        f"{md}\n\n"
        f"<!-- TEXTE BRUT COMPLET DE LA PAGE (filet anti-perte) -->\n"
        f"{digital_full.strip()}"
    )


def _choose_vision_result(vision_md: str, digital_full: str) -> str:
    """Même règle qu'avant après un passage par la vision."""
    if md_is_poor(vision_md, digital_full) and len(digital_full.split()) > 30:
        return digital_full
    if md_is_truncated(vision_md, digital_full):
        return append_digital(vision_md, digital_full)
    return vision_md


def _convert_with_docling(pdf_reader, page_index, image, ocr_hint, digital_full) -> str:
    """Convertit une page avec Docling, avec bascule vers la vision si besoin."""
    writer = PdfWriter()
    writer.add_page(pdf_reader.pages[page_index])
    page_pdf_path = TEMP_DIR / f"page_{uuid.uuid4().hex}.pdf"
    with open(page_pdf_path, "wb") as f:
        writer.write(f)

    try:
        page_md = get_doc_converter().convert(str(page_pdf_path)).document.export_to_markdown()

        if md_is_poor(page_md, digital_full):
            # 1) Docling pauvre → on tente la vision
            page_md = _choose_vision_result(call_vision(image, ocr_hint), digital_full)
        elif md_is_garbled_table(page_md) and len(digital_full.split()) > 30:
            # 1bis) Tableau désaligné : on garde Docling pour l'affichage,
            #       l'extraction utilisera le texte brut (extraction_text)
            pass
        elif md_is_truncated(page_md, digital_full):
            # 2) Docling correct mais tronqué → on ajoute le texte brut
            page_md = append_digital(page_md, digital_full)
    except Exception as e:
        logging.warning(f"[DOCLING] échec ({e}) — bascule vers la vision")
        page_md = _choose_vision_result(call_vision(image, ocr_hint), digital_full)
    finally:
        if page_pdf_path.exists():
            page_pdf_path.unlink()

    return page_md


# ─── Traitement d'un PDF complet ─────────────────────────────────────────────
def convert_pdf(file_path: str, file_name: str, progress_prefix: str):
    """
    Générateur : produit des messages de progression {"progress": ...}
    puis un résultat par page {"page_result": {...}}.
    """
    pdf_reader = PdfReader(file_path)
    dpi = get_optimal_dpi(pdf_reader)
    yield {"progress": f"{progress_prefix} - Conversion à {dpi} DPI..."}

    images = convert_from_path(file_path, dpi=dpi, poppler_path=POPPLER_PATH)
    total_pages = len(images)

    for i, image in enumerate(images):
        yield {"progress": f"{progress_prefix} - Conversion Page {i + 1}/{total_pages}"}

        decision, ocr_hint, _ = get_page_routing_decision(pdf_reader, i, image)

        # Texte numérique complet de la page : filet de sécurité + texte d'extraction
        try:
            digital_full = pdf_reader.pages[i].extract_text() or ""
        except Exception:
            digital_full = ""

        if decision == "LVM":
            page_md = _choose_vision_result(call_vision(image, ocr_hint), digital_full)
        else:
            page_md = _convert_with_docling(pdf_reader, i, image, ocr_hint, digital_full)

        # Vision sans secours : si tout a échoué, on garde le texte brut s'il existe
        if not page_md:
            page_md = digital_full

        buffered_ui = BytesIO()
        image.save(buffered_ui, format="JPEG", quality=60)

        yield {"page_result": {
            "page": i + 1,
            "fileName": file_name,
            "image": base64.b64encode(buffered_ui.getvalue()).decode("utf-8"),
            "html": None,
            "markdown": page_md,                          # affichage
            "extraction_text": digital_full or page_md,   # extraction (plus fiable)
            "type": "pdf",
        }}

        del image
        if i % 3 == 0:
            gc.collect()