#!/usr/bin/env bash
set -euo pipefail

# Track Embedding Service — setup script for GPU server
# Run as: sudo bash setup.sh

INSTALL_DIR="/opt/track-embed"
SERVICE_USER="opennews"
VENV_DIR="$INSTALL_DIR/venv"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Track Embedding Service Setup ==="

# 1. Create install directory
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/embed_service.py" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"

# 2. Create Python venv and install deps
echo "Creating Python venv..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

echo "Installing PyTorch with CUDA..."
pip install --upgrade pip
# Install PyTorch with CUDA support (adjust cu121 to match your CUDA version)
pip install torch --index-url https://download.pytorch.org/whl/cu121

echo "Installing remaining dependencies..."
pip install -r "$INSTALL_DIR/requirements.txt"

# 3. Pre-download the model (takes a few minutes)
echo "Downloading gte-large-en-v1.5 model..."
python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('Alibaba-NLP/gte-large-en-v1.5', trust_remote_code=True)"

# 4. Create systemd service
cat > /etc/systemd/system/track-embed.service <<EOF
[Unit]
Description=Track Embedding Service (GPU)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$VENV_DIR/bin/uvicorn embed_service:app --host 127.0.0.1 --port 8100
Restart=always
RestartSec=5
Environment=EMBED_MODEL=Alibaba-NLP/gte-large-en-v1.5
Environment=EMBED_MAX_BATCH=64
Environment=HUGGING_FACE_HUB_TOKEN=${HF_TOKEN:-}

# GPU access
Environment=CUDA_VISIBLE_DEVICES=0
Environment=TRANSFORMERS_CACHE=/opt/track-embed/.cache

[Install]
WantedBy=multi-user.target
EOF

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# 5. Enable and start
systemctl daemon-reload
systemctl enable track-embed
systemctl start track-embed

echo ""
echo "=== Setup complete ==="
echo "Check status:  systemctl status track-embed"
echo "View logs:     journalctl -u track-embed -f"
echo "Health check:  curl http://localhost:8100/health"
