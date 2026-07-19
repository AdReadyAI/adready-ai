import psycopg2
import requests
from openai import OpenAI
from config.settings import (
    OPENROUTER_API_KEY,
    DATABASE_URL,
    OPENROUTER_BASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    logger,
)
from functools import lru_cache  

def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn


@lru_cache(maxsize=1)
def get_storage_session() -> requests.Session:

    logger.info("Creating Supabase Storage session...")

    session = requests.Session()
    session.headers.update({
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    })
    return session

@lru_cache(maxsize=1)
def get_openrouter_client(): 

    logger.info("Creating OpenRouter client...")

    return OpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=OPENROUTER_API_KEY,
    )