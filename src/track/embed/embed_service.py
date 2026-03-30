"""
Track Embedding Service — GPU-accelerated text embeddings via gte-large-en-v1.5.

Accepts batches of text, returns 1024-dimensional embeddings.
Designed to keep up with the Bluesky firehose (~50 posts/sec).

Usage:
  uvicorn embed_service:app --host 0.0.0.0 --port 8100
"""

import os
import time
import logging
from typing import List

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from transformers import pipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("embed-service")

MODEL_NAME = os.environ.get("EMBED_MODEL", "Alibaba-NLP/gte-large-en-v1.5")
MAX_BATCH_SIZE = int(os.environ.get("EMBED_MAX_BATCH", "64"))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

logger.info(f"Loading model {MODEL_NAME} on {DEVICE}...")
model = SentenceTransformer(MODEL_NAME, device=DEVICE, trust_remote_code=True)
logger.info(f"Model loaded. Embedding dimension: {model.get_sentence_embedding_dimension()}")

logger.info(f"Loading toxicity classifier on {DEVICE}...")
toxicity_classifier = pipeline(
    "text-classification", 
    model="martin-ha/toxic-comment-model", 
    device=0 if DEVICE == "cuda" else -1,
    truncation=True,
    max_length=512
)
logger.info("Toxicity classifier loaded.")

app = FastAPI(title="Track Embed Service", version="1.0.0")


class EmbedRequest(BaseModel):
    texts: List[str] = Field(..., max_length=MAX_BATCH_SIZE)


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    is_toxic: List[bool]
    model: str
    dimension: int
    elapsed_ms: float


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEVICE,
        "dimension": model.get_sentence_embedding_dimension(),
        "cuda_available": torch.cuda.is_available(),
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest):
    if len(req.texts) == 0:
        raise HTTPException(400, "texts must not be empty")
    if len(req.texts) > MAX_BATCH_SIZE:
        raise HTTPException(400, f"max batch size is {MAX_BATCH_SIZE}")

    start = time.perf_counter()
    embeddings = model.encode(
        req.texts,
        batch_size=len(req.texts),
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    # 2. Extract toxicity classifications gracefully
    try:
        tox_results = toxicity_classifier(req.texts)
        # Model returns dicts like: {'label': 'toxic', 'score': 0.95}
        is_toxic = [res['label'] == 'toxic' and res['score'] > 0.90 for res in tox_results]
    except Exception as e:
        logger.error(f"Toxicity classification failed: {e}")
        is_toxic = [False] * len(req.texts)

    elapsed_ms = (time.perf_counter() - start) * 1000

    return EmbedResponse(
        embeddings=embeddings.tolist(),
        is_toxic=is_toxic,
        model=MODEL_NAME,
        dimension=model.get_sentence_embedding_dimension(),
        elapsed_ms=round(elapsed_ms, 2),
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("EMBED_PORT", "8100"))
    uvicorn.run(app, host="0.0.0.0", port=port)
