import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent   # le dossier backend
load_dotenv(BASE_DIR / ".env")


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Variable manquante dans le fichier .env : {name}")
    return value


# Clés des modèles
GROQ_API_KEY = _required("GROQ_API_KEY")
DEEPSEEK_API_KEY = _required("DEEPSEEK_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Noms des modèles
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
GROQ_FILTER_MODEL = os.getenv("GROQ_FILTER_MODEL", "llama-3.3-70b-versatile")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")

# Base de données
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "dbname": _required("DB_NAME"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": _required("DB_PASSWORD"),
}

# Chemins
POPPLER_PATH = os.getenv("POPPLER_PATH") or None
DATA_DIR = BASE_DIR / "data"
LEXICON_PATH = DATA_DIR / "lexique.json"
TEMP_DIR = BASE_DIR / "temp_files"
CHROMA_DIR = BASE_DIR / "chroma_db"
# Compte lecture seule de l'agent (même base, autre utilisateur)
AGENT_DB_USER = os.getenv("AGENT_DB_USER", "docspilot_agent")
AGENT_DB_PASSWORD = _required("AGENT_DB_PASSWORD")
AGENT_DB_CONFIG = {**DB_CONFIG, "user": AGENT_DB_USER, "password": AGENT_DB_PASSWORD}