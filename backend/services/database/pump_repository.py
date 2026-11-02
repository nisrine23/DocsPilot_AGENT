import json
import logging
from psycopg2.extras import RealDictCursor

from core.database import get_db_connection
from services.extraction.utils import clean_numeric_value


def _autres(cat: dict, *keys):
    """Lit un champ de 'Autres' quelle que soit l'écriture de la clé (espaces...)."""
    autres = cat.get("Autres", {})
    for k in keys:
        v = autres.get(k, {})
        if isinstance(v, dict) and v.get("valeur"):
            return v["valeur"]
    return None


def save_extraction_to_db(pump_data: dict) -> None:
    cat = pump_data.get("categories", {})
    ident = cat.get("Identification", {})
    hydro = cat.get("Caracteristiques_hydrauliques", {})

    tag = ident.get("Repere", {}).get("valeur") or pump_data.get("tag", "Inconnu")
    client_name = ident.get("Client", {}).get("valeur") or "Externe"
    flow = clean_numeric_value(hydro.get("Debit_nominal", {}).get("valeur", "0"))
    head = clean_numeric_value(hydro.get("Hauteur_manometrique", {}).get("valeur", "0"))
    exist = _autres(cat, " Pompe existante", "Pompe existante") or "N/A"
    marque_roulement = _autres(cat, " Marque des Roulements ", "Marque des Roulements",
                               "Marque_des_Roulements")
    marque_garniture = _autres(cat, " Marque de la garniture mécanique ",
                               "Marque de la garniture mécanique",
                               "Marque_de_la_garniture_mecanique")

    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO pump_extractions
                    (tag_name, client_name, flow_value, head_value, existing_pump,
                     full_json, marque_roulement, marque_garniture)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tag_name) DO UPDATE SET
                    client_name      = EXCLUDED.client_name,
                    flow_value       = EXCLUDED.flow_value,
                    head_value       = EXCLUDED.head_value,
                    existing_pump    = EXCLUDED.existing_pump,
                    full_json        = EXCLUDED.full_json,
                    marque_roulement = EXCLUDED.marque_roulement,
                    marque_garniture = EXCLUDED.marque_garniture
            """, (tag, client_name, flow, head, exist, json.dumps(cat, ensure_ascii=False),
                  marque_roulement, marque_garniture))
    except Exception as e:
        logging.error(f"[BASE] Enregistrement de {tag} impossible : {e}")
    finally:
        conn.close()


def update_extraction_field(tag: str, category: str, field: str,
                            value: str, source: str = "Saisi manuellement") -> dict:
    conn = get_db_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT full_json FROM pump_extractions WHERE tag_name = %s", (tag,))
            row = cur.fetchone()
            if not row:
                return {"status": "error", "message": "Tag introuvable"}

            js = row[0]
            js.setdefault(category, {})[field] = {"valeur": value, "page": source}

            extra_sql, extra_vals = "", []
            f = field.lower().replace(" ", "")
            if "marqueroulement" in f or "marquedesroulements" in f:
                extra_sql, extra_vals = ", marque_roulement = %s", [value]
            elif "marquegarniture" in f or "marquedelagarniture" in f:
                extra_sql, extra_vals = ", marque_garniture = %s", [value]

            cur.execute(
                f"UPDATE pump_extractions SET full_json = %s {extra_sql} WHERE tag_name = %s",
                [json.dumps(js, ensure_ascii=False)] + extra_vals + [tag])
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        conn.close()


def list_saved_pumps() -> list:
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""SELECT tag_name, client_name, flow_value, head_value, existing_pump
                           FROM pump_extractions ORDER BY created_at DESC""")
            return cur.fetchall()
    finally:
        conn.close()