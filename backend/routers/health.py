from fastapi import APIRouter
from core.database import get_db_connection

router = APIRouter(tags=["Santé"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/health/db")
def health_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        conn.close()
        return {"database": "ok"}
    except UnicodeDecodeError as e:
        return {"database": "error", "detail": e.object.decode("cp1252", errors="replace")}
    except Exception as e:
        return {"database": "error", "detail": str(e)}