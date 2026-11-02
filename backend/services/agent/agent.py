import json
import logging

from core.config import DEEPSEEK_MODEL
from core.llm_clients import client_deepseek
from services.agent.context import build_system_prompt
from services.agent.tools import get_tools, run_tool

MAX_STEPS = 6            # nombre maximal d'allers-retours avec les outils
ROWS_FOR_LLM = 50        # lignes de résultat montrées au LLM (la réponse complète reste dans les étapes)


def _for_llm(result: dict) -> str:
    """Résultat d'outil envoyé au LLM (réduit pour ne pas saturer son contexte)."""
    short = dict(result)
    if isinstance(short.get("lignes"), list) and len(short["lignes"]) > ROWS_FOR_LLM:
        short["lignes"] = short["lignes"][:ROWS_FOR_LLM]
        short["note"] = f"{ROWS_FOR_LLM} premières lignes sur {result['nb_lignes']}"
    return json.dumps(short, ensure_ascii=False, default=str)


def _sources_from(result: dict) -> list:
    """Récupère les sources (fichier - page) d'un résultat d'outil."""
    sources = []
    for p in result.get("passages", []) or []:
        sources.append(f"{p.get('fichier')} - Page {p.get('page')}")
    cols = result.get("colonnes") or []
    if "source" in cols:
        idx = cols.index("source")
        sources += [row[idx] for row in result.get("lignes", []) if row[idx]]
    return sources


def run_agent(question: str, context_on: bool = True, history: list | None = None) -> dict:
    """
    Pose une question à l'agent.
    Retourne : la réponse, les étapes (outils appelés), les requêtes SQL et les sources.
    """
    messages = [{"role": "system", "content": build_system_prompt(context_on)}]
    for msg in (history or [])[-6:]:        # un peu de mémoire de la conversation
        if msg.get("role") in ("user", "assistant") and msg.get("content"):
            messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": question})

    tools = get_tools(context_on)
    steps, sql_queries, sources = [], [], []

    for _ in range(MAX_STEPS):
        response = client_deepseek.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=messages,
            tools=tools,
            temperature=0,
        )
        msg = response.choices[0].message

        # Pas d'appel d'outil → c'est la réponse finale
        if not msg.tool_calls:
            return {
                "reponse": msg.content or "",
                "etapes": steps,
                "sql": sql_queries,
                "sources": sorted(set(sources)),
                "contexte": "ON" if context_on else "OFF",
            }

        # Le LLM demande des outils : on les exécute et on lui renvoie les résultats
        assistant_msg = {
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in msg.tool_calls
            ],
        }
        reasoning = getattr(msg, "reasoning_content", None)
        if reasoning:   # certains modèles DeepSeek exigent qu'on renvoie leur raisonnement
            assistant_msg["reasoning_content"] = reasoning
        messages.append(assistant_msg)

        for tc in msg.tool_calls:
            result = run_tool(tc.function.name, tc.function.arguments)
            logging.info(f"[AGENT] outil {tc.function.name} → "
                         f"{'erreur' if 'erreur' in result else 'ok'}")
            steps.append({"outil": tc.function.name,
                          "arguments": tc.function.arguments,
                          "resultat": result})
            if result.get("sql") and "erreur" not in result:   # seules les requêtes réussies
                sql_queries.append(result["sql"])
            sources += _sources_from(result)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": _for_llm(result)})

    return {
        "reponse": "Je n'ai pas pu terminer l'analyse en un nombre raisonnable d'étapes. "
                   "Reformulez la question ou précisez-la.",
        "etapes": steps,
        "sql": sql_queries,
        "sources": sorted(set(sources)),
        "contexte": "ON" if context_on else "OFF",
    }