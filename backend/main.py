import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import core.llm_clients  # crée les clients au démarrage (erreur immédiate si une clé manque)
from core.database import init_db
from routers import health, extraction, chat

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()          # au démarrage
    yield              # (rien à faire à l'arrêt)


app = FastAPI(title="DocsPilot API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(extraction.router)
app.include_router(chat.router)