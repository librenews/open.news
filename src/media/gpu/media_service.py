"""GPU-accelerated media processing service.

Provides transcription (faster-whisper) and audio embeddings (CLAP)
for the media intelligence pipeline.

Run: uvicorn media_service:app --host 0.0.0.0 --port 8101
"""

import os
import time
import logging
from pathlib import Path
from typing import Optional

import torch
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("media-service")

app = FastAPI(title="Media Processing Service", version="0.1.0")

# ── Models (loaded at startup) ────────────────────────────────────────────────

whisper_model = None
clap_model = None
clap_processor = None
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


@app.on_event("startup")
async def load_models():
    global whisper_model, clap_model, clap_processor

    logger.info(f"Loading models on device: {DEVICE}")

# Load faster-whisper
    from faster_whisper import WhisperModel
    logger.info("Loading faster-whisper medium (int8)...")
    whisper_model = WhisperModel(
        "medium",
        device=DEVICE,
        compute_type="int8" if DEVICE == "cuda" else "int8",
    )
    logger.info("faster-whisper loaded")

    # Load CLAP on CPU to save GPU VRAM (CLAP uses ~1.5GB)
    from transformers import ClapModel, ClapProcessor
    logger.info("Loading CLAP model on CPU...")
    clap_model = ClapModel.from_pretrained("laion/larger_clap_music_and_speech").to("cpu")
    clap_processor = ClapProcessor.from_pretrained("laion/larger_clap_music_and_speech")
    clap_model.eval()
    logger.info("CLAP loaded")

    if DEVICE == "cuda":
        mem = torch.cuda.memory_allocated() / 1024**3
        logger.info(f"GPU memory used after model load: {mem:.2f} GB")


# ── Request/Response models ───────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    audio_path: str
    transcribe: bool = True
    embed: bool = True


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptResult(BaseModel):
    text: str
    language: str
    language_probability: float
    segments: list[TranscriptSegment]
    duration_s: float
    model: str = "whisper-medium"


class ProcessResponse(BaseModel):
    transcript: Optional[TranscriptResult] = None
    embedding: Optional[list[float]] = None
    audio_features: Optional[dict] = None
    elapsed_ms: float


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/process", response_model=ProcessResponse)
async def process_audio(req: ProcessRequest):
    """Full processing pipeline: transcribe + embed audio."""
    if not Path(req.audio_path).exists():
        raise HTTPException(status_code=400, detail=f"File not found: {req.audio_path}")

    t0 = time.time()
    transcript = None
    embedding = None
    audio_features = None

    # Transcribe
    if req.transcribe and whisper_model:
        segments_raw, info = whisper_model.transcribe(
            req.audio_path,
            beam_size=5,
            vad_filter=True,
        )
        segments = []
        full_text_parts = []
        for seg in segments_raw:
            segments.append(TranscriptSegment(
                start=round(seg.start, 3),
                end=round(seg.end, 3),
                text=seg.text.strip(),
            ))
            full_text_parts.append(seg.text.strip())

        transcript = TranscriptResult(
            text=" ".join(full_text_parts),
            language=info.language,
            language_probability=round(info.language_probability, 3),
            segments=segments,
            duration_s=round(info.duration, 3),
        )

    # CLAP embedding
    if req.embed and clap_model and clap_processor:
        import torchaudio
        waveform, sr = torchaudio.load(req.audio_path)
        # Resample to 48kHz if needed (CLAP expects 48kHz)
        if sr != 48000:
            resampler = torchaudio.transforms.Resample(sr, 48000)
            waveform = resampler(waveform)
        # Mix to mono
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        # Truncate to 30 seconds for embedding (CLAP limit)
        max_samples = 48000 * 30
        if waveform.shape[1] > max_samples:
            waveform = waveform[:, :max_samples]

        inputs = clap_processor(
            audio=waveform.squeeze().numpy(),
            sampling_rate=48000,
            return_tensors="pt",
        ).to("cpu")

        with torch.no_grad():
            audio_embed = clap_model.get_audio_features(**inputs)
            if hasattr(audio_embed, "pooler_output"):
                audio_embed = audio_embed.pooler_output

        # L2 normalize
        audio_embed = audio_embed / audio_embed.norm(dim=-1, keepdim=True)
        embedding = audio_embed.squeeze().cpu().tolist()

    # Basic audio features
    try:
        import torchaudio
        waveform, sr = torchaudio.load(req.audio_path)
        audio_features = {
            "sample_rate": sr,
            "channels": waveform.shape[0],
            "duration_s": round(waveform.shape[1] / sr, 3),
            "samples": waveform.shape[1],
        }
    except Exception as e:
        logger.warning(f"Failed to extract audio features: {e}")

    elapsed_ms = round((time.time() - t0) * 1000, 1)
    logger.info(f"Processed {req.audio_path} in {elapsed_ms}ms")

    return ProcessResponse(
        transcript=transcript,
        embedding=embedding,
        audio_features=audio_features,
        elapsed_ms=elapsed_ms,
    )


@app.get("/health")
async def health():
    gpu_mem = None
    if DEVICE == "cuda":
        gpu_mem = {
            "allocated_gb": round(torch.cuda.memory_allocated() / 1024**3, 2),
            "reserved_gb": round(torch.cuda.memory_reserved() / 1024**3, 2),
        }
    return {
        "status": "ok",
        "device": DEVICE,
        "whisper_loaded": whisper_model is not None,
        "clap_loaded": clap_model is not None,
        "clap_dimension": 512,
        "gpu_memory": gpu_mem,
    }
