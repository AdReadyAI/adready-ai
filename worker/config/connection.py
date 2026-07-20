import psycopg2
# from openai import OpenAI
from config.settings import OPENROUTER_API_KEY ,DATABASE_URL , OPENROUTER_BASE_URL , logger , ASSEMBLYAI_API_KEY
from functools import lru_cache  
import assemblyai as aai

def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn



# @lru_cache(maxsize=1)
# def get_openrouter_client(): 

#     logger.info("Creating OpenRouter client...")

#     return OpenAI(
#         base_url=OPENROUTER_BASE_URL,
#         api_key=OPENROUTER_API_KEY,
#     )



@lru_cache(maxsize=1)
def get_aai_transcriber()-> aai.Transcriber:
    if not ASSEMBLYAI_API_KEY:
        raise ValueError("ASSEMBLYAI_API_KEY is not set. Please check your environment variables.")
        
    logger.info("Initializing AssemblyAI Transcriber...")
    aai.settings.api_key = ASSEMBLYAI_API_KEY
    return aai.Transcriber()