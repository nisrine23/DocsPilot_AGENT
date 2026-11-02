import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.agent.agent import run_agent

router = APIRouter(tags=["Agent"])


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, description="La question posée à l'agent")
    context_on: bool = Field(True, description="True = contexte ON, False = contexte OFF")
    history: list[dict] = Field(default_factory=list,
                                description="Messages précédents : [{role, content}, ...]")


@router.post("/chat")
def chat(req: ChatRequest):
    """Pose une question à l'agent (réponse + étapes + SQL + sources)."""
    try:
        return run_agent(req.question, context_on=req.context_on, history=req.history)
    except Exception as e:
        logging.exception("[CHAT] erreur de l'agent")
        return {
            "reponse": f"L'agent a rencontré une erreur : {e}",
            "etapes": [], "sql": [], "sources": [],
            "contexte": "ON" if req.context_on else "OFF",
            "erreur": True,
        }