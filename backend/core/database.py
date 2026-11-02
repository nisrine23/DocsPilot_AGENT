import logging
import psycopg2
from psycopg2 import sql

from core.config import DB_CONFIG, AGENT_DB_CONFIG, AGENT_DB_USER, AGENT_DB_PASSWORD, BASE_DIR

SQL_DIR = BASE_DIR / "sql"


def get_db_connection():
    """Connexion principale (lecture + écriture) : utilisée par l'extraction."""
    return psycopg2.connect(**DB_CONFIG)


def get_agent_connection():
    """Connexion LECTURE SEULE : utilisée uniquement par l'agent."""
    return psycopg2.connect(**AGENT_DB_CONFIG)


def _ensure_agent_role(cur):
    """Crée (ou met à jour) le compte de l'agent : il ne peut lire QUE pompes_vue."""
    user = sql.Identifier(AGENT_DB_USER)

    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (AGENT_DB_USER,))
    if cur.fetchone() is None:
        cur.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}")
                    .format(user, sql.Literal(AGENT_DB_PASSWORD)))
    else:
        cur.execute(sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}")
                    .format(user, sql.Literal(AGENT_DB_PASSWORD)))

    # Toute transaction de ce compte est en lecture seule
    cur.execute(sql.SQL("ALTER ROLE {} SET default_transaction_read_only = on").format(user))

    cur.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}")
                .format(sql.Identifier(DB_CONFIG["dbname"]), user))
    cur.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(user))
    cur.execute(sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {}").format(user))
    cur.execute(sql.SQL("GRANT SELECT ON pompes_vue TO {}").format(user))


def init_db():
    """Au démarrage : exécute sql/01_..., sql/02_..., puis prépare le compte de l'agent."""
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:   # "with conn" valide tout à la fin (ou annule si erreur)
            for sql_file in sorted(SQL_DIR.glob("*.sql")):
                cur.execute(sql_file.read_text(encoding="utf-8"))
                logging.info(f"SQL exécuté : {sql_file.name}")
            _ensure_agent_role(cur)
        logging.info("Base de données prête (tables, vue et compte agent vérifiés).")
    finally:
        conn.close()