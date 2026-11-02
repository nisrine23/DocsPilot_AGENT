import sqlglot
from sqlglot import exp

ALLOWED_TABLES = {"pompes_vue"}   # la SEULE table que l'agent peut lire
MAX_ROWS = 200                     # nombre maximal de lignes renvoyées

# Fonctions PostgreSQL interdites (lecture de fichiers, réglages, attente...)
FORBIDDEN_FUNCTIONS = {"dblink", "lo_import", "lo_export", "current_setting",
                       "set_config", "query_to_xml", "copy"}

# Instructions qui modifient quelque chose : interdites partout dans la requête
FORBIDDEN_NODES = tuple(
    getattr(exp, name) for name in
    ("Insert", "Update", "Delete", "Merge", "Create", "Drop", "Alter",
     "AlterTable", "TruncateTable", "Command", "Grant", "Into")
    if hasattr(exp, name)
)


class UnsafeSQLError(ValueError):
    """Requête refusée : le message explique pourquoi (il est renvoyé à l'agent)."""


def _function_name(f: exp.Func) -> str:
    if isinstance(f, exp.Anonymous):
        return str(f.name).lower()
    return (f.sql_name() or "").lower()


def check_sql(query: str) -> str:
    """
    Vérifie qu'une requête est une simple lecture de pompes_vue.
    Retourne la requête nettoyée (avec un LIMIT), ou lève UnsafeSQLError.
    """
    if not query or not query.strip():
        raise UnsafeSQLError("Requête vide.")

    try:
        statements = [s for s in sqlglot.parse(query, read="postgres") if s is not None]
    except Exception as e:
        raise UnsafeSQLError(f"SQL invalide : {e}")

    if len(statements) != 1:
        raise UnsafeSQLError("Une seule instruction SQL est autorisée.")
    stmt = statements[0]

    if not isinstance(stmt, exp.Query):
        raise UnsafeSQLError("Seules les requêtes SELECT sont autorisées.")
    if FORBIDDEN_NODES and stmt.find(*FORBIDDEN_NODES):
        raise UnsafeSQLError("La requête contient une instruction d'écriture interdite.")

    # Tables : uniquement pompes_vue (et les sous-requêtes nommées avec WITH)
    cte_names = {cte.alias_or_name.lower() for cte in stmt.find_all(exp.CTE)}
    for table in stmt.find_all(exp.Table):
        name = table.name.lower()
        schema = (table.db or "").lower()
        if name in cte_names:
            continue
        if name not in ALLOWED_TABLES or schema not in ("", "public"):
            raise UnsafeSQLError(
                f"Table non autorisée : {table.sql()}. Seule la vue pompes_vue est accessible.")

    # Fonctions système interdites
    for func in stmt.find_all(exp.Func):
        fname = _function_name(func)
        if fname.startswith("pg_") or fname in FORBIDDEN_FUNCTIONS:
            raise UnsafeSQLError(f"Fonction non autorisée : {fname}.")

    # Toujours une limite de lignes
    if stmt.args.get("limit") is None:
        stmt = stmt.limit(MAX_ROWS)

    return stmt.sql(dialect="postgres")