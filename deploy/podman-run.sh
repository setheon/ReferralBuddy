#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════
#  ReferralBuddy — Podman run script  (rootless, no Quadlet)
#  Usage:  chmod +x deploy/podman-run.sh && ./deploy/podman-run.sh
# ════════════════════════════════════════════════════════════

set -euo pipefail

IMAGE_NAME="referralbuddy"
CONTAINER_NAME="referralbuddy"
DATA_DIR="${HOME}/.local/share/referralbuddy/data"
ENV_FILE="${PWD}/.env"

# ── Validate prerequisites ────────────────────────────────────────────────────
if ! command -v podman &>/dev/null; then
  echo "❌  podman is not installed. Install it with your package manager."
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "❌  .env file not found at ${ENV_FILE}"
  echo "    Copy .env.example → .env and fill in your values."
  exit 1
fi

# ── Create data directory ─────────────────────────────────────────────────────
mkdir -p "${DATA_DIR}"
echo "📁  Data directory: ${DATA_DIR}"

# ── Build image ───────────────────────────────────────────────────────────────
echo "🔨  Building image ${IMAGE_NAME}…"
podman build -t "${IMAGE_NAME}:latest" .

# ── Stop & remove existing container ─────────────────────────────────────────
if podman container exists "${CONTAINER_NAME}" 2>/dev/null; then
  echo "🛑  Stopping existing container…"
  podman stop "${CONTAINER_NAME}" || true
  podman rm   "${CONTAINER_NAME}" || true
fi

# ── Run container ─────────────────────────────────────────────────────────────
echo "🚀  Starting ${CONTAINER_NAME}…"
podman run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --env-file "${ENV_FILE}" \
  --env "DB_PATH=/app/data/referralbuddy.db" \
  --volume "${DATA_DIR}:/app/data:Z" \
  --security-opt no-new-privileges \
  "${IMAGE_NAME}:latest"

echo ""
echo "✅  ReferralBuddy is running!"
echo "    Logs:  podman logs -f ${CONTAINER_NAME}"
echo "    Stop:  podman stop ${CONTAINER_NAME}"
echo ""

# ── Optional: generate systemd unit for auto-start on boot ───────────────────
read -rp "Generate systemd unit for auto-start on boot? [y/N] " ANSWER
if [[ "${ANSWER,,}" == "y" ]]; then
  UNIT_DIR="${HOME}/.config/systemd/user"
  mkdir -p "${UNIT_DIR}"
  podman generate systemd --new --name "${CONTAINER_NAME}" \
    > "${UNIT_DIR}/container-${CONTAINER_NAME}.service"
  systemctl --user daemon-reload
  systemctl --user enable "container-${CONTAINER_NAME}.service"
  echo "✅  Systemd unit installed and enabled."
  echo "    Start now: systemctl --user start container-${CONTAINER_NAME}"
fi
