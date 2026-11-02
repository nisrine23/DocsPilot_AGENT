import re
import gc
import json
import logging
import unicodedata

from langchain_core.documents import Document

from core.config import DEEPSEEK_MODEL, GROQ_FILTER_MODEL
from core.llm_clients import client_groq, client_deepseek, model_gemini
from services.extraction.utils import extract_json_robust
from services.extraction.lexicon import load_lexicon
from services.extraction import prompts
from services.database.pump_repository import save_extraction_to_db
from services.rag.embeddings import get_embeddings

CONTEXT_CHAR_BUDGET = 60000   # au-delà : RAG pour ne garder que les passages utiles


# ─── Préparation du texte ────────────────────────────────────────────────────
def _clean_text(s: str) -> str:
    """Normalise l'Unicode et les espaces invisibles des PDF mal encodés."""
    if not s:
        return s
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("\xa0", " ").replace("\u202f", " ").replace("\u2009", " ")
    s = s.replace("\u200b", "")
    s = re.sub(r"\s*:\s*", " : ", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s


def _build_marked_text(pages: list):
    """Texte complet avec marqueurs [[FILE | PAGE]] + documents pour le RAG."""
    documents, blocks = [], []
    for p in pages:
        source_text = p.get("extraction_text") or p.get("markdown") or ""
        block = f"[[FILE:{p['fileName']} | PAGE:{p['page']}]]\n{_clean_text(source_text)}\n[[END]]"
        blocks.append(block)
        documents.append(Document(page_content=block,
                                  metadata={"page": p["page"], "file": p["fileName"]}))
    return "\n".join(blocks) + "\n", documents


# ─── Appels aux modèles ──────────────────────────────────────────────────────
def _deepseek_json(system: str, prompt: str, json_mode: bool = True):
    kwargs = dict(
        model=DEEPSEEK_MODEL,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": prompt}],
        stream=False,
        temperature=0,
        reasoning_effort="low",
    )
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    raw = client_deepseek.chat.completions.create(**kwargs).choices[0].message.content
    return json.loads(extract_json_robust(raw) or raw)


def _gemini_json(prompt: str):
    if model_gemini is None:
        raise RuntimeError("Gemini non configuré")
    raw = model_gemini.generate_content(prompt).text
    return json.loads(extract_json_robust(raw) or raw)


# ─── Étape 1 : repères des pompes ────────────────────────────────────────────
def _detect_tags(full_text: str) -> list:
    prompt = prompts.build_tag_prompt(full_text)
    tags = []
    try:
        res = client_groq.chat.completions.create(
            model=GROQ_FILTER_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        tags = json.loads(res.choices[0].message.content).get("tags", [])
    except Exception as e:
        logging.warning(f"[REPÈRES] Groq a échoué ({e}) — secours DeepSeek")
        try:
            tags = _deepseek_json("Réponds UNIQUEMENT en JSON.", prompt).get("tags", [])
        except Exception as e2:
            logging.error(f"[REPÈRES] DeepSeek a échoué aussi ({e2})")
    return tags or ["Équipement Principal"]


# ─── Étape 2 : extraction d'une pompe ────────────────────────────────────────
def _extract_one(tag: str, context: str, lex_body: dict):
    prompt = prompts.build_extraction_prompt(tag, context, lex_body)
    system = ("Tu es un moteur d'extraction. Tu ne raisonnes pas, tu RECOPIES "
              "fidèlement les valeurs présentes dans le texte. Réponds "
              "UNIQUEMENT avec un objet JSON valide, sans texte ni balises.")
    try:
        data = _deepseek_json(system, prompt)
        logging.info(f"[EXTRACTION] {tag} → DeepSeek")
        return data
    except Exception as e:
        logging.warning(f"[EXTRACTION] DeepSeek a échoué pour {tag} ({e}) — secours Gemini")
    try:
        data = _gemini_json(prompt)
        logging.info(f"[EXTRACTION] {tag} → Gemini (secours)")
        return data
    except Exception as e:
        logging.error(f"[EXTRACTION] Échec complet pour {tag} ({e})")
        return None


# ─── Étape 3 : passe dédiée aux matériaux ────────────────────────────────────
def _material_pass(tag: str, context: str, lex_body: dict, pump_data: dict) -> None:
    mat_lexicon = lex_body.get("Materiau", {})
    syn_to_field = {
        s.lower().strip(): field
        for field, syns in mat_lexicon.items() if field != "Autres_composants"
        for s in syns
    }
    mat_prompt = prompts.build_material_prompt(tag, context)

    mat_list = None
    try:
        parsed = _deepseek_json(
            "Tu extrais des couples composant/matériau. Réponds UNIQUEMENT "
            "avec un tableau JSON, sans texte autour.",
            mat_prompt, json_mode=False)
        mat_list = parsed if isinstance(parsed, list) else parsed.get("composants") or parsed.get("items")
    except Exception as e:
        logging.warning(f"[MATÉRIAUX] DeepSeek a échoué ({e}) — secours Gemini")
        try:
            parsed = _gemini_json(mat_prompt)
            mat_list = parsed if isinstance(parsed, list) else parsed.get("composants") or parsed.get("items")
        except Exception as e2:
            logging.warning(f"[MATÉRIAUX] passe ignorée pour {tag} ({e2})")
            return

    if not isinstance(mat_list, list):
        return
    logging.info(f"[MATÉRIAUX] {tag} → {len(mat_list)} composants")

    pump_data.setdefault("Materiau", {})
    for item in mat_list:
        if not isinstance(item, dict):
            continue
        comp = str(item.get("composant", "")).strip()
        mater = str(item.get("materiau", "")).strip()
        page = str(item.get("page", "")).strip()
        if not comp or not mater:
            continue
        field = syn_to_field.get(comp.lower())
        if field:
            # composant connu : on remplit seulement si le champ était vide
            cur = pump_data["Materiau"].get(field)
            cur_val = cur.get("valeur", "") if isinstance(cur, dict) else cur
            if not cur_val or str(cur_val).strip() == "":
                pump_data["Materiau"][field] = {"valeur": mater, "page": page}
        elif comp not in pump_data["Materiau"]:
            # composant hors liste : il devient son propre champ
            pump_data["Materiau"][comp] = {"valeur": mater, "page": page}


# ─── Étape 4 : dédoublonnage ─────────────────────────────────────────────────
def _norm(s) -> str:
    return "".join(c for c in str(s).upper() if c.isalnum())


def _merge_or_append(final_results: list, real_tag: str, pump_data: dict) -> dict:
    """Même pompe sous deux écritures (04XP02 / 04XP02 PLR125) → on fusionne."""
    nt = _norm(real_tag)
    for r in final_results:
        rt = _norm(r["tag"])
        if rt == nt or rt.startswith(nt) or nt.startswith(rt):
            if len(str(real_tag)) > len(str(r["tag"])):
                r["tag"] = real_tag
            for cat, fields in pump_data.items():
                if not isinstance(fields, dict):
                    continue
                r["categories"].setdefault(cat, {})
                for field, info in fields.items():
                    cur = r["categories"][cat].get(field)
                    cur_val = cur.get("valeur", "") if isinstance(cur, dict) else cur
                    new_val = info.get("valeur", "") if isinstance(info, dict) else info
                    if (not cur_val or str(cur_val).strip() == "") and new_val:
                        r["categories"][cat][field] = info
            return r
    item = {"tag": real_tag, "categories": pump_data}
    final_results.append(item)
    return item


# ─── Fonction principale ─────────────────────────────────────────────────────
def extract_features(pages: list, lexicon: dict | None = None) -> list:
    if not pages:
        return []
    lexicon = lexicon or load_lexicon()
    lex_body = lexicon.get("lexique_technique_pompes", lexicon)

    full_text, documents = _build_marked_text(pages)
    tags = _detect_tags(full_text)

    vectorstore = None
    if len(full_text) > CONTEXT_CHAR_BUDGET:
        from langchain_community.vectorstores import Chroma
        vectorstore = Chroma.from_documents(documents, get_embeddings())

    final_results = []
    try:
        for tag in tags:
            if vectorstore is None:
                context = full_text   # document normal : tout le texte
            else:
                docs = vectorstore.similarity_search(
                    f"Toutes les spécifications techniques, conditions opératoires, "
                    f"matériaux, données moteur et électriques de la pompe repère {tag}",
                    k=min(40, len(documents)))
                context = "\n\n".join(d.page_content for d in docs)

            pump_data = _extract_one(tag, context, lex_body)
            if pump_data is None:
                continue
            if "lexique_technique_pompes" in pump_data:
                pump_data = pump_data["lexique_technique_pompes"]

            _material_pass(tag, context, lex_body, pump_data)

            real_tag = pump_data.get("Identification", {}).get("Repere", {}).get("valeur") or tag
            item = _merge_or_append(final_results, real_tag, pump_data)
            save_extraction_to_db(item)
    finally:
        if vectorstore is not None:
            vectorstore.delete_collection()
        gc.collect()

    return final_results