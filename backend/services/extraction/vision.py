import base64
import logging
from io import BytesIO

from core.config import GROQ_VISION_MODEL
from core.llm_clients import client_groq


def call_vision(image, ocr_hint: str = "") -> str:
    """
    Reconstruit une page (image) en Markdown avec le modèle de vision Groq.
    Pas de secours : en cas d'échec on renvoie "" et l'appelant
    se rabat sur le texte numérique PyPDF2.
    """
    try:
        buffered = BytesIO()
        image.convert("RGB").save(buffered, format="JPEG", quality=95)
        img_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

        response = client_groq.chat.completions.create(
            model=GROQ_VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text",
                     "text": ("Tu es un expert en fiches techniques de pompes. Recopie FIDÈLEMENT "
                              "en Markdown tout le texte et tous les tableaux de cette page, dans "
                              "l'ordre où ils apparaissent. N'ajoute AUCUN titre, résumé, commentaire "
                              "ni phrase d'introduction, et n'invente rien. Si un mot est illisible, "
                              f"écris [illisible]. Texte OCR indicatif (peut être incomplet) : {ocr_hint}")},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
                ],
            }],
            temperature=0,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        logging.warning(f"[VISION] Groq a échoué ({e}) — repli sur le texte PyPDF2")
        return ""