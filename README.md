# DocsPilot

**DocsPilot transforme des fiches techniques (PDF, Word, Excel) en données structurées, puis permet de les interroger en langage naturel grâce à un agent IA qui cite ses sources.**

L'application se fait en deux temps :

1. **Extraction** : les documents sont convertis page par page en Markdown. Les pages inutiles (page de garde, sommaire) sont écartées. Ensuite, chaque caractéristique de chaque composant (débit, hauteur, matériaux, moteur…) est extraite avec la page d'où elle vient, puis enregistrée dans PostgreSQL.
2. **Interrogation** : un agent répond aux questions (« Quelles machines ont un corps en inox ? »). Pour cela, il choisit lui-même ses outils : une requête SQL sur les données, une recherche dans le texte des documents ou une consultation du glossaire métier. Chaque réponse montre les requêtes exécutées et les pages utilisées.

Un sélecteur **Avec contexte / Sans contexte** permet de comparer les réponses de l'agent avec ou sans la documentation métier : description des colonnes, règles et glossaire.

---

## Sommaire
1. [Fonctionnement général](#1-fonctionnement-général)
2. [Technologies utilisées](#2-technologies-utilisées)
3. [Arborescence complète](#3-arborescence-complète)
4. [Description de chaque fichier — Backend](#4-description-de-chaque-fichier--backend)
5. [Description de chaque fichier — Frontend](#5-description-de-chaque-fichier--frontend)
6. [Installation (une seule fois)](#6-installation-une-seule-fois)
7. [Lancer l'application](#7-lancer-lapplication)
8. [Routes de l'API](#8-routes-de-lapi)

---

## 1. Fonctionnement général

```
                         ┌──────────────── EXTRACTION ────────────────┐
 PDF / Word / Excel ──►  Conversion en Markdown, page par page
                         │   • PDF natif  → Docling (texte + tableaux)
                         │   • Page scannée → modèle de vision Groq
                         ▼
                         Filtrage des pages (Groq, secours DeepSeek)
                         │   Garde / Sommaire / Technique
                         ▼
                         Extraction des caractéristiques (DeepSeek, secours Gemini)
                         │   repères des pompes → champs du lexique → passe matériaux
                         ▼
          ┌──────────────┴───────────────┐
          ▼                              ▼
   PostgreSQL                        ChromaDB (RAG)
   table pump_extractions (JSON)     texte des pages découpé en morceaux
   vue pompes_vue (1 ligne/pompe)    + fichier et page de chaque morceau
          │                              │
          └──────────────┬───────────────┘
                         ▼
                 ┌──────────────── AGENT ────────────────┐
 Question ──►    Agent DeepSeek (boucle d'appels d'outils, 6 étapes max)
                 │   query_table      → SQL en lecture seule sur pompes_vue
                 │   search_documents → passages des documents (RAG)
                 │   lookup_glossary  → termes métier (contexte ON seulement)
                 ▼
                 Réponse + étapes + requêtes SQL + pages citées
```

### Modèles d'IA

| Étape | Modèle principal | Modèle de secours |
|---|---|---|
| Lecture des pages scannées (vision) | Groq `qwen/qwen3.8-27b` | aucun : on garde le texte brut PyPDF2 |
| Filtrage des pages | Groq `openai/gpt-oss-120b` | DeepSeek |
| Extraction des caractéristiques | DeepSeek `deepseek-v4-flash` | Gemini |
| Agent (chat) | DeepSeek `deepseek-v4-flash` | aucun |

### Sécurité de l'agent
L'agent n'a **jamais** le droit de modifier les données :
- il se connecte avec un compte PostgreSQL dédié, `docspilot_agent`, en **lecture seule**, qui ne voit que la vue `pompes_vue` ;
- chaque requête passe d'abord par un **garde-fou** (`sqlglot`) : une seule instruction, `SELECT` uniquement, uniquement sur `pompes_vue`, pas de fonctions système, et 200 lignes au maximum ;
- chaque requête est arrêtée si elle dure plus de **5 secondes**.

---

## 2. Technologies utilisées

### Backend (Python)

| Technologie | Rôle dans le projet |
|---|---|
| **FastAPI** | Framework web : expose les routes de l'API (`/process-pdf`, `/chat`…) |
| **Uvicorn** | Serveur qui fait tourner l'application FastAPI |
| **python-multipart** | Permet de recevoir des fichiers envoyés par le navigateur |
| **python-dotenv** | Lit les clés et mots de passe du fichier `.env` |
| **PostgreSQL + psycopg2** | Base de données des fiches pompes ; psycopg2 est le connecteur Python |
| **Docling** | Convertit les pages PDF natives en Markdown en gardant les tableaux |
| **PyPDF2** | Lit le texte numérique des PDF (aide au routage et texte de secours) |
| **pdf2image + Poppler** | Transforme chaque page PDF en image (Poppler fait le rendu) |
| **EasyOCR** | Retrouve la position d'une valeur sur l'image (surlignage des citations) |
| **python-docx / openpyxl / pandas** | Lecture des fichiers Word et Excel |
| **LibreOffice** | Génère un aperçu image des fichiers Word |
| **Pillow / NumPy / OpenCV** | Traitement des images (analyse des pixels, formats) |
| **Groq** | API des modèles de vision et de filtrage |
| **openai** (SDK) | Client utilisé pour appeler **DeepSeek** (API compatible OpenAI) |
| **google-generativeai** | Appel à **Gemini**, modèle de secours de l'extraction |
| **LangChain** (`langchain-core`, `langchain-community`) | Interface commune pour la base vectorielle et les documents du RAG |
| **ChromaDB** | Base vectorielle qui stocke le texte des pages pour la recherche par sens |
| **sentence-transformers** (`all-MiniLM-L6-v2`) | Transforme un texte en vecteur (embeddings) pour la recherche RAG |
| **sqlglot** | Analyse les requêtes SQL de l'agent pour bloquer tout ce qui n'est pas autorisé |

### Frontend (JavaScript / TypeScript)

| Technologie | Rôle dans le projet |
|---|---|
| **Next.js 16** (App Router) | Framework React : pages, navigation, serveur de développement |
| **React 19** | Construction de l'interface en composants |
| **TypeScript** | JavaScript typé, pour éviter les erreurs |
| **Tailwind CSS 4** | Mise en forme par classes utilitaires (couleurs, espacements…) |
| **@tailwindcss/typography** | Mise en forme automatique du Markdown affiché (`prose`) |
| **react-markdown + remark-gfm** | Affiche le Markdown des pages et des réponses, avec les tableaux |
| **lucide-react** | Icônes |
| **xlsx** | Export des fiches pompes en Excel |
| **jsPDF + jspdf-autotable** | Export des fiches pompes en PDF |

---

## 3. Arborescence complète

```
docspilot/
├── README.md
├── .vscode/                              réglages de l'éditeur (interpréteur Python du venv)
│
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env                              (secret, non partagé)
│   ├── .env.example
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── database.py
│   │   └── llm_clients.py
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── health.py
│   │   ├── extraction.py
│   │   └── chat.py
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── extraction/
│   │   │   ├── __init__.py
│   │   │   ├── conversion.py
│   │   │   ├── vision.py
│   │   │   ├── word_excel.py
│   │   │   ├── filtering.py
│   │   │   ├── prompts.py
│   │   │   ├── features.py
│   │   │   ├── lexicon.py
│   │   │   ├── locate.py
│   │   │   └── utils.py
│   │   ├── database/
│   │   │   ├── __init__.py
│   │   │   └── pump_repository.py
│   │   ├── rag/
│   │   │   ├── __init__.py
│   │   │   ├── embeddings.py
│   │   │   ├── indexer.py
│   │   │   └── search.py
│   │   └── agent/
│   │       ├── __init__.py
│   │       ├── agent.py
│   │       ├── tools.py
│   │       ├── context.py
│   │       └── sql_guard.py
│   │
│   ├── sql/
│   │   ├── 01_create_tables.sql
│   │   └── 02_pompes_vue.sql
│   │
│   ├── data/
│   │   ├── lexique.json
│   │   └── context/
│   │       ├── colonnes.json
│   │       ├── glossaire.json
│   │       └── regles.md
│   │
│   ├── venv/                             (généré) environnement Python
│   ├── chroma_db/                        (généré) base vectorielle du RAG
│   └── temp_files/                       (généré) fichiers envoyés, supprimés après conversion
│
└── frontend/
    ├── package.json
    ├── package-lock.json
    ├── .env.local
    ├── .gitignore
    ├── next.config.ts
    ├── tsconfig.json
    ├── eslint.config.mjs
    ├── next-env.d.ts
    ├── AGENTS.md
    ├── README.md
    ├── public/
    │   ├── file.svg
    │   ├── globe.svg
    │   ├── next.svg
    │   ├── vercel.svg
    │   └── window.svg
    ├── app/
    │   ├── layout.tsx
    │   ├── providers.tsx
    │   ├── globals.css
    │   ├── favicon.ico
    │   ├── page.tsx
    │   ├── extraction/
    │   │   └── page.tsx
    │   ├── chat/
    │   │   └── page.tsx
    │   ├── components/
    │   │   ├── NavBar.tsx
    │   │   ├── ui.tsx
    │   │   └── CitationBadge.tsx
    │   ├── context/
    │   │   ├── ExtractionContext.tsx
    │   │   └── LanguageContext.tsx
    │   └── lib/
    │       └── api.ts
    ├── node_modules/                     (généré) bibliothèques JavaScript
    └── .next/                            (généré) cache de compilation de Next.js
```

---

## 4. Description de chaque fichier — Backend

### Racine du backend

> Les fichiers `__init__.py` (dans `core/`, `routers/`, `services/` et chacun de ses sous-dossiers) sont **vides volontairement** : ils indiquent à Python que le dossier est un package, ce qui permet les imports du type `from services.agent.tools import run_tool`.

**`main.py`** : point d'entrée de l'API. Il ne contient aucune logique métier :
- il crée l'application FastAPI ;
- au démarrage, il appelle `init_db()` pour préparer la base ;
- il autorise le frontend (`localhost:3000`) à appeler l'API (CORS) ;
- il branche les trois routeurs `health`, `extraction` et `chat`.

Il importe aussi `core.llm_clients` dès le lancement : si une clé API manque, l'erreur apparaît tout de suite.

**`requirements.txt`** : liste des bibliothèques Python à installer, regroupées par usage : serveur web, base de données, lecture des documents, modèles, RAG et sécurité SQL.

**`.env`** : fichier secret, à ne jamais partager. Il contient les clés API, les noms des modèles, les accès PostgreSQL, le chemin de Poppler et le mot de passe du compte de l'agent.

**`.env.example`** : modèle du `.env`, avec les mêmes noms de variables mais sans les valeurs. Il sert à savoir quoi remplir sur une nouvelle machine.

### `core/` : configuration et connexions partagées

**`config.py`** : lit le `.env` et met à disposition toutes les constantes du projet :
- les clés API et les noms des modèles ;
- `DB_CONFIG`, les accès à la base ;
- `AGENT_DB_CONFIG`, la même base mais avec le compte lecture seule de l'agent ;
- les chemins : `data/`, `lexique.json`, `temp_files/`, `chroma_db/` et Poppler.

La fonction `_required()` arrête le programme avec un message clair si une variable obligatoire manque.

**`database.py`** : tout ce qui concerne la connexion PostgreSQL.
- `get_db_connection()` : connexion principale, en lecture et écriture, utilisée par l'extraction.
- `get_agent_connection()` : connexion **en lecture seule**, utilisée uniquement par l'agent.
- `init_db()` : lancée au démarrage. Elle exécute dans l'ordre tous les fichiers de `sql/` (création de la table, puis de la vue), puis appelle `_ensure_agent_role()`.
- `_ensure_agent_role()` : crée ou met à jour le compte `docspilot_agent`. Le compte est forcé en lecture seule, on lui retire tous les droits, puis on lui donne seulement `SELECT` sur `pompes_vue`.

**`llm_clients.py`** : crée une seule fois les clients des trois fournisseurs d'IA :
- `client_groq` ;
- `client_deepseek`, c'est-à-dire le SDK OpenAI pointé vers `api.deepseek.com` ;
- `model_gemini`.

Tous les autres fichiers importent ces clients au lieu d'en recréer.

### `routers/` : les routes de l'API (la « porte d'entrée »)

Les routeurs reçoivent la requête, appellent le bon service et renvoient le résultat. Ils ne contiennent pas de logique métier.

**`health.py`** : deux routes de vérification.
- `/health` : l'API tourne.
- `/health/db` : la connexion à PostgreSQL fonctionne. Les erreurs PostgreSQL en français, encodées en `cp1252` sous Windows, sont décodées pour rester lisibles.

**`extraction.py`** : toutes les routes de la page Extraction.
- `/process-pdf` : enregistre les fichiers reçus dans `temp_files/` et les traite un par un : PDF, Word ou Excel. Pendant le traitement, il renvoie la progression ligne par ligne au format **NDJSON** (`{"progress": "...Page 3/12"}`), puis le résultat final (`{"final_data": [...]}`). Les fichiers temporaires sont supprimés après.
- `/filter-pages` : envoie les pages au service de filtrage.
- `/extract-features` : lance l'extraction, puis indexe les pages gardées dans le RAG. Si l'indexation échoue, l'extraction n'est pas perdue.
- `/update-extraction-field` : enregistre une valeur corrigée ou saisie à la main.
- `/update-lexicon` : ajoute une caractéristique au lexique.
- `/locate-value` : renvoie la position d'une valeur sur l'image d'une page.
- `/get-saved-pumps` : liste les pompes enregistrées.

Les routes sont des fonctions `def` classiques, pas `async` : FastAPI les exécute dans des fils séparés, donc un long traitement ne bloque pas le serveur.

**`chat.py`** : la route `/chat`. Elle reçoit la question, le mode contexte (`context_on`) et l'historique de la conversation, appelle l'agent et renvoie sa réponse. En cas d'erreur, elle renvoie un message lisible au lieu de planter.

### `services/extraction/` : le pipeline d'extraction

**`conversion.py`** : conversion d'un PDF en Markdown, **page par page**.
- `get_optimal_dpi()` : choisit la résolution des images, 200 DPI pour un PDF numérique ou 250 pour un scan.
- `detect_page_type()` et `get_page_routing_decision()` : **routage** de chaque page.
  - Si la page contient plus de 30 mots de texte numérique, c'est un PDF natif : on utilise **Docling**.
  - Sinon, on mesure la variance des pixels : une image riche ou un scan va au **modèle de vision**.
- `get_doc_converter()` : charge Docling une seule fois, au premier besoin, car il est lourd (~1 Go).
- `md_is_poor()`, `md_is_garbled_table()`, `md_is_truncated()` et `append_digital()` : **contrôles qualité**. Si le Markdown est trop pauvre, si un tableau est illisible ou si le texte est coupé, on complète avec le texte numérique brut.
- `convert_pdf()` : la fonction principale. C'est un générateur qui renvoie la progression puis, pour chaque page :
  - l'image de la page ;
  - le `markdown`, utilisé pour l'affichage ;
  - l'`extraction_text`, le texte le plus fiable, utilisé pour l'extraction.

**`vision.py`** : `call_vision()` envoie l'image d'une page au modèle de vision Groq. La consigne est de recopier **fidèlement** le contenu en Markdown, sans titre ni résumé ajouté, et d'écrire `[illisible]` quand un passage ne se lit pas. Il n'y a pas de modèle de secours : en cas d'erreur, la fonction renvoie un texte vide et `conversion.py` garde le texte PyPDF2.

**`word_excel.py`** : lecture des fichiers non PDF.
- `process_word_docx()` : extrait le texte et les tableaux d'un Word et les convertit en Markdown. Si LibreOffice est installé, elle génère aussi un aperçu image (`_find_libreoffice()` et `_render_docx_to_images()`).
- `process_excel()` : convertit chaque feuille Excel en tableau Markdown et en aperçu HTML.

**`filtering.py`** : classe chaque page en **Garde**, **Sommaire** ou **Technique** avec un LLM, Groq en premier et DeepSeek en secours (`_classify()` avec la consigne de `_user_prompt()`). La fonction renvoie seulement les pages à vérifier, avec la raison. C'est l'utilisateur qui décide de les écarter ou de les garder.

**`prompts.py`** : toutes les consignes envoyées aux modèles pendant l'extraction.
- `build_tag_prompt()` : trouver les repères des pompes présentes dans les documents.
- `build_extraction_prompt()` : remplir chaque champ du lexique pour une pompe, avec sa source. Le prompt contient des règles anti-confusion, par exemple ne pas confondre débit nominal et débit maximal, ou NPSH disponible et NPSH requis.
- `build_material_prompt()` : passe dédiée aux matériaux (corps, impulseur, arbre…).

**`features.py`** : le cœur de l'extraction, avec `extract_features()`.
1. `_build_marked_text()` : assemble le texte de toutes les pages avec des marqueurs `[[FILE:… | PAGE:…]]`, pour que le modèle sache d'où vient chaque valeur.
2. `_detect_tags()` : détecte les repères des pompes, avec Groq puis DeepSeek en secours.
3. Si le texte dépasse 60 000 caractères, une base vectorielle temporaire ne garde que les passages utiles pour chaque pompe.
4. `_extract_one()` : extraction de tous les champs du lexique pour une pompe, avec DeepSeek puis Gemini en secours (`_deepseek_json()` et `_gemini_json()`).
5. `_material_pass()` : deuxième passage pour compléter les matériaux.
6. `_merge_or_append()` : si une même pompe apparaît dans plusieurs documents, les informations sont fusionnées.
7. `save_extraction_to_db()` : enregistre chaque fiche dans PostgreSQL.

**`lexicon.py`** : `load_lexicon()` lit `data/lexique.json`. `add_lexicon_entry()` y ajoute une nouvelle caractéristique avec ses libellés français, anglais et autres.

**`locate.py`** : `locate_value()` lit le texte d'une image de page avec **EasyOCR** et renvoie les coordonnées de la valeur cherchée. Le lecteur EasyOCR est chargé une seule fois. Cette fonction sert à surligner la valeur citée sur la page.

**`utils.py`** : deux petits outils.
- `extract_json_robust()` : récupère le JSON dans la réponse d'un modèle, même entouré de texte.
- `clean_numeric_value()` : transforme « 24 m3/h » en nombre `24.0`.

### `services/database/` : accès aux données des pompes

**`pump_repository.py`** : toutes les opérations sur la table `pump_extractions`.
- `save_extraction_to_db()` : enregistre une fiche (repère, client, débit, hauteur, marques, et le JSON complet). Si le repère existe déjà, il est mis à jour (*upsert*).
- `update_extraction_field()` : modifie un seul champ dans le JSON quand l'utilisateur corrige une valeur.
- `list_saved_pumps()` : renvoie la liste des fiches enregistrées.

### `services/rag/` : recherche dans le texte des documents

**`embeddings.py`** : `get_embeddings()` charge une seule fois le modèle `all-MiniLM-L6-v2`. Ce modèle transforme un texte en vecteur de nombres : deux textes de sens proche donnent deux vecteurs proches.

**`indexer.py`** : enregistre le texte des pages dans **ChromaDB**. La base est conservée dans `backend/chroma_db`, collection `docspilot_pages`.
- `_chunk()` : découpe chaque page en morceaux de 1 000 caractères, avec 150 caractères de chevauchement pour ne pas couper une information en deux. La coupe se fait de préférence à un retour à la ligne.
- `index_pages()` : supprime d'abord les anciens morceaux des mêmes fichiers, pour éviter les doublons, puis enregistre les nouveaux avec leur fichier et leur page.

**`search.py`** : `search_documents()` renvoie les `k` passages les plus proches d'une question, avec le texte, le fichier, la page et la distance.

### `services/agent/` : l'agent IA

**`agent.py`** : `run_agent()`, la **boucle de l'agent**.
1. Il construit les messages : consigne système, les 6 derniers messages de la conversation, puis la question.
2. Il appelle DeepSeek en lui donnant la liste des outils disponibles.
3. Si le modèle demande un outil, il l'exécute, enregistre l'étape et renvoie le résultat au modèle, en limitant le tableau à 50 lignes pour ne pas le saturer.
4. Il recommence jusqu'à ce que le modèle donne sa réponse finale, ou jusqu'à 6 étapes au maximum.

Il renvoie la réponse, toutes les étapes (outil, arguments, résultat), les requêtes SQL réussies, les sources et le mode de contexte utilisé.

**`tools.py`** : les **trois outils** de l'agent.
- `query_table(sql)` : vérifie la requête avec le garde-fou, se connecte avec le compte lecture seule, limite la durée à 5 s, puis renvoie les colonnes et les lignes. En cas d'erreur, l'erreur est renvoyée à l'agent, qui peut corriger sa requête.
- `search_documents(question, k)` : recherche RAG dans les documents.
- `glossary(terme)` : définition d'un terme métier.

Le fichier contient aussi `TOOL_SCHEMAS`, la description de chaque outil au format *function calling* que le modèle lit pour savoir quoi appeler. `get_tools()` retire le glossaire quand le contexte est désactivé, et `run_tool()` exécute l'outil demandé.

**`context.py`** : construit ce que l'agent sait des données.
- `get_view_columns()` : lit les noms des colonnes de `pompes_vue` directement dans la base.
- `build_system_prompt(context_on)` : écrit la consigne système de l'agent.
  - **Sans contexte**, il ne voit que les noms des colonnes.
  - **Avec contexte**, il reçoit aussi la description de chaque colonne (`colonnes.json`) et les règles métier (`regles.md`).
- `lookup_glossary()` : cherche un terme dans `glossaire.json`, puis dans les synonymes du lexique, sans tenir compte des accents ni des majuscules.

**`sql_guard.py`** : `check_sql()` analyse la requête de l'agent avec **sqlglot** avant de l'exécuter. Elle refuse :
- plus d'une instruction ;
- tout ce qui n'est pas un `SELECT` ;
- toute écriture (`INSERT`, `DROP`…) ;
- toute table autre que `pompes_vue` ;
- les fonctions système (`pg_*`, `dblink`…).

Si la requête n'a pas de limite, elle ajoute `LIMIT 200`. Le message de refus est renvoyé à l'agent pour qu'il corrige sa requête.

### `sql/` : structure de la base (exécutés automatiquement au démarrage)

**`01_create_tables.sql`** : crée la table `pump_extractions`. Elle contient une ligne par pompe, avec quelques colonnes utiles (repère unique, client, débit, hauteur, pompe existante, marques) et la fiche complète dans `full_json` (JSONB).

**`02_pompes_vue.sql`** : crée la fonction `docspilot_num()`, qui extrait le nombre d'un texte comme « 24 m3/h », puis la vue **`pompes_vue`**. C'est la seule « table » que l'agent peut lire. Elle aplatit le JSON en colonnes claires : repère, client, type, fluide, débit, hauteur, NPSH, puissance, vitesse, matériaux, marques, source…

Pour les grandeurs utiles aux calculs, la vue donne deux colonnes : le **texte d'origine** (`debit_texte`) et une **valeur numérique dans une unité commune** (`debit_m3h`). Les conversions sont faites dans la vue, par exemple l/s × 3,6 → m³/h et HP × 0,7457 → kW.

### `data/` : connaissances métier

**`lexique.json`** : la liste des caractéristiques à extraire, réparties en 8 catégories : Identification, Produit, Hydraulique, Mécanique, Matériaux, Fonctionnement, Peinture, Autres. Pour chaque champ, le fichier donne tous les libellés possibles en français et en anglais (ex. « Débit nominal », « Rated flow », « Capacity »).

**`context/colonnes.json`** : la description en français de chaque colonne de `pompes_vue`, avec l'unité et le sens (ex. `debit_m3h` : débit nominal converti en m³/h). Il n'est envoyé à l'agent qu'avec le contexte activé.

**`context/glossaire.json`** : définitions des termes métier et colonnes concernées. Exemple : « inox » = 304, 316, 316L, CF8M → colonnes `materiau_*`. Il contient aussi des alias comme HMT, NPSH et puissance absorbée.

**`context/regles.md`** : règles métier données à l'agent. Exemples : toujours utiliser les colonnes numériques pour les calculs, citer la colonne `source`, dire clairement quand une information n'existe pas.

---

## 5. Description de chaque fichier — Frontend

### Configuration

**`package.json` / `package-lock.json`** : liste des bibliothèques JavaScript et leurs versions exactes, ainsi que les commandes (`npm run dev`, `npm run build`).

**`.env.local`** : adresse du backend, `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`.

**`next.config.ts`** : configuration de Next.js.

**`tsconfig.json`** : configuration de TypeScript.

**`eslint.config.mjs`** : règles de vérification du code (ESLint).

**`next-env.d.ts`** : types de Next.js, généré automatiquement (à ne pas modifier).

**`.gitignore`** : fichiers à ne pas envoyer sur Git (`node_modules`, `.next`…).

**`AGENTS.md` / `README.md`** : fichiers créés automatiquement par `create-next-app`. Ils ne sont pas utilisés par l'application.

**`public/*.svg`** : icônes par défaut de Next.js. Elles ne sont pas utilisées par l'application.

### `app/` : les pages et la structure

**`layout.tsx`** : structure commune à toutes les pages. Il charge la police **Inter** et place la barre latérale (`NavBar`), la barre du haut (`TopBar`) et la zone de contenu.

**`providers.tsx`** : regroupe les « contextes » partagés par toutes les pages : langue, état de l'extraction et notifications.

**`globals.css`** : couleurs de l'application (bleu nuit `#0d1b2e` pour la barre latérale, marine `#1A2B4A`, cyan `#4FC3F7`, rouge `#E63946`), police, barre de défilement, anneau de focus pour la navigation au clavier, et désactivation des animations si l'utilisateur le demande.

**`favicon.ico`** : icône de l'onglet.

**`page.tsx`** (accueil) : présentation de l'application. On y trouve :
- deux cartes d'accès, Extraction et Chat agent ;
- le parcours d'un document en 4 étapes ;
- le tableau des 3 outils de l'agent ;
- un exemple de réponse avec sa requête SQL et ses sources.

**`extraction/page.tsx`** : la page d'extraction, en 4 étapes affichées en haut.
1. **Documents** :
   - glisser-déposer des fichiers ;
   - conversion avec barre de progression (lecture du flux NDJSON) ;
   - visionneuse avec la barre des pages `p.1 p.2…`, la page d'origine et le texte reconnu côte à côte, en mode Aperçu, Markdown ou Corriger.
2. **Filtrage** : analyse des pages. Chaque page suspecte affiche sa raison et deux boutons, Garder ou Écarter. Une page écartée peut être restaurée.
3. **Extraction** : lancement de l'extraction, puis la fiche de chaque pompe :
   - jauge « champs trouvés » ;
   - onglets par catégorie et filtre « seulement les manquants » ;
   - correction ou saisie d'une valeur avec sa source ;
   - citation cliquable vers la page ;
   - export Excel ou PDF.
4. **Lexique** : formulaire pour ajouter une nouvelle caractéristique et ses synonymes.

**`chat/page.tsx`** : la page de l'agent.
- **À gauche**, la conversation : questions d'exemple, réponses en Markdown, badge Avec / Sans contexte, sources et zone de saisie.
- **À droite**, le panneau **Traçabilité** de la réponse sélectionnée : chaque outil appelé dans l'ordre, la requête SQL et son tableau de résultats, les passages lus, les erreurs corrigées, et les pages citées.
- En haut, le sélecteur **Avec contexte / Sans contexte**.

La conversation est conservée quand on change de page.

### `app/components/` : composants réutilisables

**`NavBar.tsx`** : contient deux composants.
- `NavBar` : la barre latérale sombre. Elle n'affiche que les icônes et s'ouvre au survol de la souris ou au clavier. Elle contient les liens Accueil, Extraction et Chat agent, et une pastille qui indique si le backend répond (appel à `/health`).
- `TopBar` : la barre du haut, avec le titre de la page et le bouton de langue.

**`ui.tsx`** : le **design system**, les briques utilisées par toutes les pages :
- `Button` (4 variantes), `Card`, `PageHeader`, `SectionTitle` ;
- `Badge`, `ProgressBar`, `EmptyState` ;
- `Tabs` (onglets), `Menu` (menu déroulant), `Stepper` (indicateur d'étapes) ;
- `ToastProvider` / `useToast`, les notifications qui remplacent les `alert()`.

**`CitationBadge.tsx`** : la pastille numérotée à côté d'une valeur extraite. Au clic, elle ouvre la page source et surligne la valeur, grâce à la route `/locate-value`.

### `app/context/` : état partagé

**`ExtractionContext.tsx`** : garde les données de l'extraction entre les pages : pages converties, suggestions de filtrage, pages écartées, résultats et étape atteinte. Ces données sont sauvegardées dans le `sessionStorage` du navigateur (clés `docspilot_…`), donc on ne les perd pas en allant sur le chat.

**`LanguageContext.tsx`** : langue de l'interface (français / anglais). La fonction `t("texte FR", "texte EN")` choisit le bon texte.

### `app/lib/`

**`api.ts`** : l'adresse du backend, lue dans `.env.local`. C'est la seule source pour toutes les pages.

---

## 6. Installation (une seule fois)

### Logiciels à installer

| Logiciel | Pourquoi |
|---|---|
| **Python 3.11+** | Faire tourner le backend |
| **Node.js 20+** | Faire tourner le frontend |
| **PostgreSQL** (+ pgAdmin) | Base de données |
| **Poppler** (Windows) | Rendu des pages PDF en images (pdf2image) ; son dossier `bin` va dans `POPPLER_PATH` |
| **LibreOffice** (optionnel) | Aperçu image des fichiers Word |
| Clés API **Groq**, **DeepSeek**, **Gemini** | Modèles d'IA |

### Base de données
Dans pgAdmin, créer une base vide nommée **`docspilot_db`**. La table, la vue et le compte lecture seule de l'agent sont créés **automatiquement** au premier lancement du backend.

### Backend
```powershell
cd C:\Users\user\Desktop\docspilot\backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```
Copier `.env.example` en `.env` et remplir les valeurs :
```
GROQ_API_KEY=...
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
GROQ_VISION_MODEL=qwen/qwen3.8-27b
GROQ_FILTER_MODEL=openai/gpt-oss-120b
DEEPSEEK_MODEL=deepseek-v4-flash
GEMINI_MODEL=gemini-flash-latest
DB_HOST=localhost
DB_PORT=5432
DB_NAME=docspilot_db
DB_USER=postgres
DB_PASSWORD=...
POPPLER_PATH=C:\chemin\vers\poppler\Library\bin
AGENT_DB_USER=docspilot_agent
AGENT_DB_PASSWORD=...
```

### Frontend
```powershell
cd C:\Users\user\Desktop\docspilot\frontend
npm install
```

---

## 7. Lancer l'application

Il faut **deux terminaux ouverts en même temps**.

### Terminal 1 — Backend
```powershell
cd C:\Users\user\Desktop\docspilot\backend
.\venv\Scripts\activate
uvicorn main:app --reload --port 8000
```
- `.\venv\Scripts\activate` active l'environnement Python : `(venv)` apparaît au début de la ligne.
- `uvicorn main:app` lance l'objet `app` du fichier `main.py`.
- `--reload` redémarre automatiquement le serveur quand on modifie un fichier.
- `--port 8000` indique l'adresse du backend, http://127.0.0.1:8000.

Le backend est prêt quand le terminal affiche `Base de données prête` puis `Application startup complete`.

Vérifications :
- http://127.0.0.1:8000/health/db doit répondre `{"database":"ok"}` ;
- http://127.0.0.1:8000/docs affiche toutes les routes, testables directement.

### Terminal 2 — Frontend
```powershell
cd C:\Users\user\Desktop\docspilot\frontend
npm run dev
```
Ouvrir **http://localhost:3000**. La pastille « Backend » en bas de la barre latérale doit être **verte**.

> La première conversion est plus lente : Docling et EasyOCR se chargent en mémoire au premier usage.

### Arrêter
`Ctrl + C` dans chaque terminal.

---

## 8. Routes de l'API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | L'API répond |
| GET | `/health/db` | La base répond |
| POST | `/process-pdf` | Conversion des documents en Markdown (progression en flux NDJSON) |
| POST | `/filter-pages` | Pages à vérifier (garde, sommaire) |
| POST | `/extract-features` | Extraction des fiches pompes + enregistrement + indexation RAG |
| POST | `/update-extraction-field` | Correction ou saisie manuelle d'une valeur |
| POST | `/update-lexicon` | Ajout d'une caractéristique au lexique |
| POST | `/locate-value` | Position d'une valeur sur l'image d'une page |
| GET | `/get-saved-pumps` | Liste des pompes enregistrées |
| POST | `/chat` | Question à l'agent (`question`, `context_on`, `history`) |
