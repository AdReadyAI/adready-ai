"""Unit tests for the process-level model loader cache (config/models.py)."""

from unittest.mock import MagicMock, patch

import pytest

pytestmark = pytest.mark.unit

import config.models as models


@pytest.fixture(autouse=True)
def _clear_caches():
    # lru_cache persists across tests in one process — reset around each test.
    models.get_east.cache_clear()
    models.get_mobileclip.cache_clear()
    yield
    models.get_east.cache_clear()
    models.get_mobileclip.cache_clear()


# ---- missing weights raise clearly (lru_cache does not cache exceptions) ----
def test_get_east_missing_path_raises():
    with patch.object(models, "EAST_MODEL_PATH", "/nonexistent/east.pb"):
        with pytest.raises(FileNotFoundError):
            models.get_east()


def test_get_mobileclip_load_failure_propagates():
    with patch(
        "config.models.open_clip.create_model_and_transforms",
        side_effect=RuntimeError("weights unavailable"),
    ):
        with pytest.raises(RuntimeError):
            models.get_mobileclip()


# ---- singleton: weights load once even across many calls ----
def test_get_east_loads_once():
    fake_net = MagicMock()
    with patch.object(models, "EAST_MODEL_PATH", "/tmp/east.pb"), \
         patch("config.models.os.path.exists", return_value=True), \
         patch("config.models.cv2.dnn.readNet", return_value=fake_net) as mock_read:
        first = models.get_east()
        second = models.get_east()

    assert first is second is fake_net
    mock_read.assert_called_once()          # 2 calls, 1 load


def test_get_mobileclip_loads_once():
    fake_model, fake_preprocess = MagicMock(), MagicMock()
    with patch(
        "config.models.open_clip.create_model_and_transforms",
        return_value=(fake_model, None, fake_preprocess),
    ) as mock_create:
        m1, p1 = models.get_mobileclip()
        m2, p2 = models.get_mobileclip()

    assert (m1, p1) == (m2, p2) == (fake_model, fake_preprocess)
    mock_create.assert_called_once()        # loaded once
    fake_model.eval.assert_called_once()    # eval() applied
