import time
import requests
import sys
import os
import wave
from pathlib import Path

# Fix pour l'import de la config (remonte de 3 niveaux vers worker/)
sys.path.append(str(Path(__file__).resolve().parent.parent.parent.parent))

API_KEY =  "" 

# ----------------------------- CONFIG -------------------------------------- #
HERE = Path(__file__).parent
MODEL_NAME = "openai/whisper-large-v3"  
HOSTED_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
ESTIMATED_RUN_COST = 0.0015

def get_audio_duration(file_path: Path) -> float:
    try:
        with wave.open(str(file_path), 'r') as f:
            return f.getnframes() / float(f.getframerate())
    except Exception:
        return 0.0

def run_benchmark(audio_file):
    if not audio_file.exists():
        print(f"File not found: {audio_file}")
        return

    duration = get_audio_duration(audio_file)
    headers = {"Authorization": f"Bearer {API_KEY}", "HTTP-Referer": "http://localhost", "X-Title": "AdReady-AI"}
    files = {"file": (audio_file.name, audio_file.open("rb"), "audio/wav")}
    
    print(f"\n--- Testing: {audio_file.name} ---")
    t0 = time.perf_counter()
    resp = requests.post(HOSTED_URL, headers=headers, data={"model": MODEL_NAME}, files=files, timeout=300)
    wall = time.perf_counter() - t0
    
    if resp.status_code == 200:
        print(f"Status: Success | Wall-clock: {wall:.3f}s | Duration: {duration:.2f}s")
        print(f"Cost per run: ${ESTIMATED_RUN_COST:.4f}")
    else:
        print(f"Error {resp.status_code}: {resp.text}")

if __name__ == "__main__":
    # Liste tes 3 fichiers
    files = ["Copper Compression.wav", "LiquidIV.wav", "Small Talk ｜ Everyday English [ry9SYnV3svc].wav"]
    for f_name in files:
        run_benchmark(HERE / f_name)