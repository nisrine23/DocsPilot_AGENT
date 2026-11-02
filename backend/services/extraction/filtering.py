import json
import logging

from core.config import GROQ_FILTER_MODEL, DEEPSEEK_MODEL
from core.llm_clients import client_groq, client_deepseek

SYSTEM = "Tu es un expert en tri. Réponds UNIQUEMENT en JSON."


def _user_prompt(content: str) -> str:
    return (
        "Classe cette page d'un dossier technique de pompes.\n"
        "- 'Garde' : page de garde (titre du document, nom du projet, client, révision, "
        "date, tableau de signatures), sans données techniques détaillées.\n"
        "- 'Sommaire' : table des matières, c'est-à-dire une liste de titres de sections "
        "suivis de numéros de page (souvent avec des points de suite '....'). "
        "Une page qui ne fait que LISTER des titres est un Sommaire, MÊME si ces titres "
        "parlent de technique.\n"
        "- 'Technique' : toute page qui contient de vraies données (valeurs, tableaux, "
        "unités, matériaux, notes).\n\n"
        f"Texte de la page :\n{content[:1000]}\n\n"
        "Réponds strictement en JSON : "
        "{\"is_useless\": true, \"type\": \"Garde\"} ou "
        "{\"is_useless\": true, \"type\": \"Sommaire\"} ou "
        "{\"is_useless\": false, \"type\": \"Technique\"}"
    )

def _classify(client, model: str, content: str) -> dict:
    res = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": _user_prompt(content)},
        ],
        response_format={"type": "json_object"},
        temperature=0,
    )
    return json.loads(res.choices[0].message.content)


def filter_pages(pages: list) -> list:
    """Retourne les pages SUGGÉRÉES à la suppression (l'utilisateur décide)."""
    suggestions = []
    for item in pages:
        content = item.get("markdown", "") or ""
        page, file_name = item.get("page"), item.get("fileName")

        if len(content.strip()) < 50:
            suggestions.append({"page": page, "fileName": file_name, "reason": "Page vide"})
            continue

        analysis = None
        try:
            analysis = _classify(client_groq, GROQ_FILTER_MODEL, content)
        except Exception as e:
            logging.warning(f"[FILTRAGE] Groq a échoué ({e}) — secours DeepSeek")
            try:
                analysis = _classify(client_deepseek, DEEPSEEK_MODEL, content)
            except Exception as e2:
                logging.warning(f"[FILTRAGE] DeepSeek a échoué aussi ({e2}) — page gardée")

        if analysis and str(analysis.get("is_useless")).lower() == "true":
            suggestions.append({"page": page, "fileName": file_name, "reason": analysis.get("type")})

    return suggestions