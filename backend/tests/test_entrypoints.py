from adready.orchestrator.main import health
from adready.workers.inference.main import main as inference_main
from adready.workers.media.main import main as media_main


def test_orchestrator_health() -> None:
    assert health() == {"status": "ok"}


def test_worker_entrypoints_are_callable() -> None:
    assert callable(media_main)
    assert callable(inference_main)
