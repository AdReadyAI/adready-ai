import psycopg2
from .settings import DATABASE_URL
from openai import OpenAI
from config.settings import OPENROUTER_API_KEY

def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn



def get_openrouter_client():
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=OPENROUTER_API_KEY,
    )