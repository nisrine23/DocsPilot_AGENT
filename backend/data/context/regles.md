# Règles métier pour interroger pompes_vue

1. Une ligne de pompes_vue = un repère de pompe. Pour « combien de pompes », compter les lignes (COUNT(*)). Si la question porte sur le nombre d'UNITÉS, regarder aussi nombre_pompes.
2. Les colonnes *_m3h, *_m, *_kw, *_c, *_rpm contiennent le PREMIER nombre trouvé dans le texte : en général la valeur normale/nominale. Pour une valeur « design », « maximale » ou « minimale », lire la colonne *_texte correspondante.
3. NULL veut dire « information absente du document », jamais zéro. Ne pas compter un NULL comme 0 dans une moyenne : AVG ignore déjà les NULL.
4. Puissance absorbée ≠ puissance moteur. « Puissance » sans précision = puissance moteur.
5. NPSH : npsh_texte peut contenir un NPSH requis (NPSHr) ou disponible (NPSHa). Le préciser dans la réponse.
6. Matériaux : les textes sont libres (FR/EN). Toujours chercher avec ILIKE et plusieurs synonymes (voir l'outil lookup_glossary), ex. inox = inox, stainless, 316, 304, duplex, CF8M.
7. Comparaisons de texte : toujours insensibles à la casse (ILIKE '%...%').
8. Pour une liste de pompes, toujours sélectionner repere et source, pour pouvoir citer la provenance.
9. Si une question porte sur une note, une condition particulière ou un détail absent des colonnes, utiliser search_documents.
10. Les données viennent d'une extraction automatique : si un résultat semble incohérent (ex. une puissance en mètres), le signaler.