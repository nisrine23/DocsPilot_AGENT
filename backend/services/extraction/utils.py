import re


def extract_json_robust(text: str) -> str:
    """Récupère le bloc {...} d'une réponse de LLM (même s'il y a du texte autour)."""
    try:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            return text[start:end + 1]
        return ""
    except Exception:
        return ""


def clean_numeric_value(value_str) -> float:
    """Premier nombre d'un texte ("24 m3/h ..." → 24.0). Convertit l/s en m3/h."""
    if not value_str or value_str == "N/A":
        return 0.0
    try:
        num_match = re.findall(r"(\d+[\.,]?\d*)", str(value_str).replace(" ", ""))
        if not num_match:
            return 0.0
        val = float(num_match[0].replace(",", "."))
        if any(u in str(value_str).lower() for u in ["l/s", "l/sec"]):
            val *= 3.6
        return val
    except Exception:
        return 0.0