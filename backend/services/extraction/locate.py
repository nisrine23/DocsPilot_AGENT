import base64
import logging

import cv2
import numpy as np

_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        logging.info("Chargement d'EasyOCR (premier surlignage)...")
        import easyocr
        _reader = easyocr.Reader(["fr", "en"], gpu=False)
    return _reader


def locate_value(image_b64: str, value: str):
    """Retourne le cadre {x, y, width, height, img_w, img_h} de la valeur, ou None."""
    if not image_b64 or not value:
        return None

    img_array = np.frombuffer(base64.b64decode(image_b64), dtype=np.uint8)
    img_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    results = _get_reader().readtext(img_cv)

    value_lower = value.lower().strip()
    best_bbox, best_score = None, 0
    for coords, text, conf in results:
        if value_lower in text.lower():
            score = conf * len(text)
            if score > best_score:
                best_score = score
                xs = [p[0] for p in coords]
                ys = [p[1] for p in coords]
                best_bbox = {
                    "x": int(min(xs)), "y": int(min(ys)),
                    "width": int(max(xs) - min(xs)), "height": int(max(ys) - min(ys)),
                    "img_w": img_cv.shape[1], "img_h": img_cv.shape[0],
                }
    return best_bbox