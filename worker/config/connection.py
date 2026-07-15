import psycopg2
from openai import OpenAI
from config.settings import OPENROUTER_API_KEY ,DATABASE_URL , OPENROUTER_BASE_URL
from functools import lru_cache

def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn



@lru_cache(maxsize=1)
def get_openrouter_client(): 
    return OpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=OPENROUTER_API_KEY,
    )