import logging
from groq import Groq
from openai import OpenAI
import google.generativeai as genai
from core import config

client_groq = Groq(api_key=config.GROQ_API_KEY)

client_deepseek = OpenAI(
    api_key=config.DEEPSEEK_API_KEY,
    base_url="https://api.deepseek.com",
)

model_gemini = None
if config.GEMINI_API_KEY:
    genai.configure(api_key=config.GEMINI_API_KEY)
    model_gemini = genai.GenerativeModel(config.GEMINI_MODEL)
else:
    logging.warning("GEMINI_API_KEY absente : pas de secours Gemini pour l'extraction")