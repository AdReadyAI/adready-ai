import psycopg2
from .settings import DATABASE_URL


def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn
