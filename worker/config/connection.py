import psycopg2
from worker.config.config import DATABASE_URL


def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn
