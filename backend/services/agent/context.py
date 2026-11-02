import json
import logging
import unicodedata

from core.config import DATA_DIR
from core.database import get_agent_connection

CONTEXT_DIR = DATA_DIR / "context"


def _load_json(name: str) -> dict:
    with open(CONTEXT_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def get_view_columns() -> list:
    """Noms des colonnes de pompes_vue, lus directement dans la base."""
    try:
        conn = get_agent_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("""SELECT column_name FROM information_schema.columns
                               WHERE table_name = 'pompes_vue' ORDER BY ordinal_position""")
                cols = [r[0] for r in cur.fetchall()]
            conn.rollback()
        finally:
            conn.close()
        if cols:
            return cols
    except Exception as e:
        logging.warning(f"[CONTEXTE] colonnes lues depuis colonnes.json ({e})")
    return list(_load_json("colonnes.json").keys())


BASE_INSTRUCTIONS = """Tu es l'agent d'analyse de DocsPilot. Tu réponds à des questions sur des fiches techniques de pompes déjà extraites.

Tu disposes d'outils :
- query_table : exécute une requête SQL SELECT (PostgreSQL) sur la vue pompes_vue (une ligne par pompe).
- search_documents : cherche des passages dans le texte des documents (notes, conditions particulières, détails absents des colonnes).
{glossary_tool}
Méthode :
1. Pour toute question chiffrée (compter, moyenne, maximum, filtrer, lister), utilise query_table. Ne devine jamais un chiffre.
2. Si une requête échoue, lis le message d'erreur, corrige la requête et réessaie.
3. Pour un détail rédigé dans un document, utilise search_documents.
4. Si l'information n'existe pas dans les données, dis-le clairement au lieu d'inventer.

Réponse finale : en français, courte et précise. Donne le résultat, puis indique les sources (fichier et page) quand tu les as."""

GLOSSARY_TOOL_LINE = ("- lookup_glossary : donne la définition d'un terme métier et les colonnes "
                      "concernées (ex. inox, HMT, NPSH, puissance absorbée).\n")


def build_system_prompt(context_on: bool) -> str:
    """
    Contexte OFF : l'agent ne voit que les NOMS des colonnes.
    Contexte ON  : + descriptions des colonnes + règles métier + glossaire.
    """
    columns = get_view_columns()

    if not context_on:
        return (BASE_INSTRUCTIONS.format(glossary_tool="")
                + "\n\n## Vue disponible : pompes_vue\nColonnes : " + ", ".join(columns))

    descriptions = _load_json("colonnes.json")
    lines = [f"- {c} : {descriptions.get(c, '(pas de description)')}" for c in columns]
    rules = (CONTEXT_DIR / "regles.md").read_text(encoding="utf-8")

    return (BASE_INSTRUCTIONS.format(glossary_tool=GLOSSARY_TOOL_LINE)
            + "\n\n## Vue disponible : pompes_vue\n" + "\n".join(lines)
            + "\n\n" + rules)


def lookup_glossary(term: str) -> dict:
    """Cherche un terme dans le glossaire métier puis dans les synonymes du lexique."""
    q = _strip_accents((term or "").lower().strip())
    if not q:
        return {"terme": term, "resultats": []}

    results = []

    # 1) Glossaire métier (définitions + colonnes à utiliser)
    for key, entry in _load_json("glossaire.json").items():
        names = [key] + entry.get("alias", [])
        names = [_strip_accents(n.lower()) for n in names]
        # égalité, ou inclusion dans un sens ou dans l'autre (sauf alias très courts : "q", "ss"...)
        if any(q == n or (len(q) >= 3 and q in n) or (len(n) >= 4 and n in q) for n in names):
            results.append({"terme": key, **entry})

    # 2) Lexique d'extraction (synonymes FR/EN des champs)
    with open(DATA_DIR / "lexique.json", "r", encoding="utf-8") as f:
        lexique = json.load(f).get("lexique_technique_pompes", {})
    for category, fields in lexique.items():
        for field, syns in fields.items():
            names = [field] + syns
            if any(q in _strip_accents(n.lower()) for n in names if len(n.strip()) > 2):
                results.append({"champ_lexique": field.strip(), "categorie": category,
                                "synonymes": [s.strip() for s in syns]})

    return {"terme": term, "resultats": results[:8]}