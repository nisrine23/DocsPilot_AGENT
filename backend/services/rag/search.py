from services.rag.indexer import get_vectorstore


def search_documents(query: str, k: int = 5) -> list:
    """Retourne les k passages les plus proches de la question, avec leur source."""
    results = get_vectorstore().similarity_search_with_score(query, k=k)
    return [
        {
            "texte": doc.page_content,
            "fichier": doc.metadata.get("file"),
            "page": doc.metadata.get("page"),
            "distance": round(float(score), 3),   # plus c'est petit, plus c'est proche
        }
        for doc, score in results
    ]