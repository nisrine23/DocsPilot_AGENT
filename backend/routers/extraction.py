import os
import json
import shutil
import logging
from typing import List

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import StreamingResponse
from services.rag.indexer import index_pages

from core.config import TEMP_DIR
from services.extraction.conversion import convert_pdf
from services.extraction.word_excel import process_word_docx, process_excel
from services.extraction.filtering import filter_pages as run_filter
from services.extraction.features import extract_features as run_extraction
from services.extraction.lexicon import add_lexicon_entry
from services.extraction.locate import locate_value as run_locate
from services.database import pump_repository

router = APIRouter(tags=["Extraction"])


def _line(obj) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


# ── 1. Conversion des documents en Markdown (flux de progression) ───────────
@router.post("/process-pdf")
def process_pdf(files: List[UploadFile] = File(...)):
    TEMP_DIR.mkdir(exist_ok=True)

    saved = []
    for file in files:
        safe_name = os.path.basename(file.filename)
        path = TEMP_DIR / safe_name
        with open(path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved.append((path, safe_name))

    def generate_progress():
        all_results = []
        total = len(saved)
        for f_idx, (path, name) in enumerate(saved):
            prefix = f"Fichier {f_idx + 1}/{total} : {name}"
            yield _line({"progress": f"{prefix} - Préparation..."})
            try:
                lower = name.lower()
                if lower.endswith(".docx"):
                    yield _line({"progress": f"{prefix} - Lecture Word..."})
                    all_results.extend(process_word_docx(str(path), name))
                elif lower.endswith((".xlsx", ".xls")):
                    yield _line({"progress": f"{prefix} - Lecture Excel..."})
                    all_results.extend(process_excel(str(path), name))
                else:
                    yield _line({"progress": f"{prefix} - Lecture des pages..."})
                    for event in convert_pdf(str(path), name, prefix):
                        if "progress" in event:
                            yield _line(event)
                        else:
                            all_results.append(event["page_result"])
            except Exception as e:
                logging.exception(f"Erreur sur {name}")
                yield _line({"progress": f"{prefix} - Erreur : {e}"})
            finally:
                if path.exists():
                    path.unlink()
        yield _line({"final_data": all_results})

    return StreamingResponse(generate_progress(), media_type="application/x-ndjson")


# ── 2. Filtrage des pages ────────────────────────────────────────────────────
@router.post("/filter-pages")
def filter_pages(pages: List[dict]):
    return run_filter(pages)


# ── 3. Extraction des caractéristiques ──────────────────────────────────────
@router.post("/extract-features")
def extract_features(payload: dict):
    pages = payload.get("pages", [])
    results = run_extraction(pages, payload.get("lexicon"))

    # Indexation RAG des pages gardées (une erreur ici ne casse pas l'extraction)
    try:
        index_pages(pages)
    except Exception:
        logging.exception("[RAG] Indexation impossible")

    return results


# ── 4. Correction manuelle d'un champ ───────────────────────────────────────
@router.post("/update-extraction-field")
def update_extraction_field(payload: dict):
    return pump_repository.update_extraction_field(
        tag=payload.get("tag"),
        category=payload.get("category"),
        field=payload.get("field"),
        value=payload.get("value"),
        source=payload.get("source", "Saisi manuellement"),
    )


# ── 5. Ajout d'une caractéristique au lexique ───────────────────────────────
@router.post("/update-lexicon")
def update_lexicon(new_entry: dict):
    try:
        add_lexicon_entry(new_entry)
        return {"status": "success"}
    except Exception as e:
        logging.exception("update-lexicon")
        return {"status": "error", "message": str(e)}


# ── 6. Localisation d'une valeur sur l'image (surlignage) ───────────────────
@router.post("/locate-value")
def locate_value(payload: dict):
    try:
        return {"bbox": run_locate(payload.get("image"), payload.get("value"))}
    except Exception as e:
        logging.warning(f"locate-value : {e}")
        return {"bbox": None}


# ── 7. Liste des pompes enregistrées ────────────────────────────────────────
@router.get("/get-saved-pumps")
def get_saved_pumps():
    return pump_repository.list_saved_pumps()