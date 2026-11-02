import logging
import threading

from langchain_core.documents import Document

from core.config import CHROMA_DIR
from services.rag.embeddings import get_embeddings

COLLECTION = "docspilot_pages"
CHUNK_SIZE = 1000      # taille d'un morceau (caractères)
CHUNK_OVERLAP = 150    # chevauchement entre deux morceaux (pour ne pas couper une info)

_vectorstore = None
_lock = threading.Lock()


def get_vectorstore():
    """Base vectorielle ChromaDB enregistrée dans backend/chroma_db (ouverte une seule fois)."""
    global _vectorstore
    with _lock:
        if _vectorstore is None:
            from langchain_community.vectorstores import Chroma
            CHROMA_DIR.mkdir(exist_ok=True)
            _vectorstore = Chroma(
                collection_name=COLLECTION,
                embedding_function=get_embeddings(),
                persist_directory=str(CHROMA_DIR),
            )
    return _vectorstore


def _chunk(text: str) -> list:
    """Découpe un texte en morceaux, de préférence à un retour à la ligne."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= CHUNK_SIZE:
        return [text]

    chunks, start = [], 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        if end < len(text):
            cut = text.rfind("\n", start + CHUNK_SIZE // 2, end)
            if cut != -1:
                end = cut
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
    return [c for c in chunks if c]


def index_pages(pages: list) -> int:
    """Indexe les pages gardées. Retourne le nombre de morceaux enregistrés."""
    vs = get_vectorstore()

    # 1) on retire les anciens morceaux des mêmes fichiers (pas de doublons)
    for file_name in {p["fileName"] for p in pages}:
        old_ids = vs.get(where={"file": file_name})["ids"]
        if old_ids:
            vs.delete(ids=old_ids)

    # 2) on découpe et on enregistre
    docs, ids = [], []
    for p in pages:
        text = p.get("extraction_text") or p.get("markdown") or ""
        for i, chunk in enumerate(_chunk(text)):
            docs.append(Document(
                page_content=chunk,
                metadata={"file": p["fileName"], "page": str(p["page"])},
            ))
            ids.append(f'{p["fileName"]}|{p["page"]}|{i}')

    if docs:
        vs.add_documents(docs, ids=ids)
    logging.info(f"[RAG] {len(docs)} morceaux indexés ({len(pages)} pages)")
    return len(docs)