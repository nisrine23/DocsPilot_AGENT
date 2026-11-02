import logging

_embeddings = None


def get_embeddings():
    global _embeddings
    if _embeddings is None:
        logging.info("Chargement du modèle d'embeddings all-MiniLM-L6-v2...")
        from langchain_community.embeddings import SentenceTransformerEmbeddings
        _embeddings = SentenceTransformerEmbeddings(model_name="all-MiniLM-L6-v2")
    return _embeddings