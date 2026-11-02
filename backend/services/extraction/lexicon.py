import json
import threading
from core.config import LEXICON_PATH

_lock = threading.Lock()


def load_lexicon() -> dict:
    with open(LEXICON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def add_lexicon_entry(new_entry: dict) -> None:
    """Ajoute un champ au lexique : {category, name, fr, en, others: [...]}."""
    with _lock:
        lex = load_lexicon()
        cat = new_entry["category"]
        name = new_entry["name"]
        syns = list({name, new_entry.get("fr", ""), new_entry.get("en", "")}
                    | set(new_entry.get("others", [])))
        syns = [s for s in syns if s]
        lex["lexique_technique_pompes"].setdefault(cat, {})[name] = syns
        with open(LEXICON_PATH, "w", encoding="utf-8") as f:
            json.dump(lex, f, indent=2, ensure_ascii=False)