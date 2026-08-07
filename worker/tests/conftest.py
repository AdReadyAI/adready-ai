"""Shared pytest configuration.

`config.settings` reads several required environment variables at import time.
Unit tests never connect to real services, so provide harmless defaults here
before any test module (and therefore `config.settings`) is imported. This
centralizes what individual test files previously duplicated at their top.
"""

import os

_TEST_ENV_DEFAULTS = {
    "DATABASE_URL": "postgresql://postgres:postgres@localhost:54322/postgres",
    "SUPABASE_URL": "http://localhost:54321",
    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
    "ASSEMBLYAI_API_KEY": "test-assemblyai-key",
}

for _key, _value in _TEST_ENV_DEFAULTS.items():
    os.environ.setdefault(_key, _value)
