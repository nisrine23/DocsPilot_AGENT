import json
import datetime
import decimal
import logging

from core.database import get_agent_connection
from services.agent.sql_guard import check_sql, UnsafeSQLError, MAX_ROWS
from services.agent.context import lookup_glossary
from services.rag.search import search_documents as rag_search


def _clean(value):
    """Rend une valeur SQL lisible en JSON (dates, décimaux)."""
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    return value


def query_table(sql: str) -> dict:
    """Outil 1 : requête SELECT en lecture seule sur pompes_vue."""
    try:
        safe_sql = check_sql(sql)
    except UnsafeSQLError as e:
        return {"erreur": str(e), "sql": sql}

    try:
        conn = get_agent_connection()
    except UnicodeDecodeError as e:
        return {"erreur": e.object.decode("cp1252", errors="replace"), "sql": safe_sql}
    except Exception as e:
        return {"erreur": f"Connexion impossible : {e}", "sql": safe_sql}

    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '5s'")
            cur.execute(safe_sql)
            columns = [d[0] for d in cur.description]
            rows = [[_clean(v) for v in row] for row in cur.fetchmany(MAX_ROWS)]
        return {"sql": safe_sql, "colonnes": columns, "lignes": rows, "nb_lignes": len(rows)}
    except Exception as e:
        return {"erreur": str(e).strip(), "sql": safe_sql}
    finally:
        conn.rollback()
        conn.close()


def search_documents(question: str, k: int = 5) -> dict:
    """Outil 2 : recherche de passages dans les documents (RAG)."""
    try:
        return {"passages": rag_search(question, k=max(1, min(int(k), 10)))}
    except Exception as e:
        logging.warning(f"[OUTIL] search_documents : {e}")
        return {"erreur": str(e)}


def glossary(terme: str) -> dict:
    """Outil 3 : définition d'un terme métier."""
    return lookup_glossary(terme)


# ─── Description des outils pour le LLM (format « function calling ») ────────
TOOL_SCHEMAS = {
    "query_table": {
        "type": "function",
        "function": {
            "name": "query_table",
            "description": "Exécute UNE requête SQL SELECT (PostgreSQL) sur la vue pompes_vue "
                           "et renvoie les colonnes et les lignes. Lecture seule.",
            "parameters": {
                "type": "object",
                "properties": {"sql": {"type": "string", "description": "La requête SELECT."}},
                "required": ["sql"],
            },
        },
    },
    "search_documents": {
        "type": "function",
        "function": {
            "name": "search_documents",
            "description": "Cherche dans le texte des documents les passages les plus proches "
                           "d'une question. Renvoie le texte, le fichier et la page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "Ce qu'il faut chercher."},
                    "k": {"type": "integer", "description": "Nombre de passages (1 à 10).", "default": 5},
                },
                "required": ["question"],
            },
        },
    },
    "lookup_glossary": {
        "type": "function",
        "function": {
            "name": "lookup_glossary",
            "description": "Donne la définition d'un terme métier (ex. inox, HMT, NPSH, "
                           "puissance absorbée) et les colonnes de pompes_vue concernées.",
            "parameters": {
                "type": "object",
                "properties": {"terme": {"type": "string", "description": "Le terme à définir."}},
                "required": ["terme"],
            },
        },
    },
}

TOOL_FUNCTIONS = {
    "query_table": lambda args: query_table(args.get("sql", "")),
    "search_documents": lambda args: search_documents(args.get("question", ""), args.get("k", 5)),
    "lookup_glossary": lambda args: glossary(args.get("terme", "")),
}


def get_tools(context_on: bool) -> list:
    """Contexte OFF : pas de glossaire (l'agent ne voit que les noms de colonnes)."""
    names = ["query_table", "search_documents"] + (["lookup_glossary"] if context_on else [])
    return [TOOL_SCHEMAS[n] for n in names]


def run_tool(name: str, arguments: str) -> dict:
    try:
        args = json.loads(arguments or "{}")
    except json.JSONDecodeError:
        return {"erreur": "Arguments JSON invalides."}
    func = TOOL_FUNCTIONS.get(name)
    if func is None:
        return {"erreur": f"Outil inconnu : {name}"}
    return func(args)