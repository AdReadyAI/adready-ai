from fastapi import FastAPI

app = FastAPI(title="AdReady Orchestrator")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def main() -> None:
    import uvicorn

    uvicorn.run(
        "adready.orchestrator.main:app",
        host="0.0.0.0",
        port=8000,
    )
