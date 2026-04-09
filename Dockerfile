# ════════════════════════════════════════════════════════════
#  ReferralBuddy — Dockerfile
#  Multi-stage build: slim production image (~120 MB)
# ════════════════════════════════════════════════════════════

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first to leverage layer caching
COPY package*.json ./

# Install production deps — pure JS only, no native compilation needed
RUN npm ci --omit=dev


# ── Stage 2: Runtime image ────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Non-root user for security
RUN addgroup -S referralbuddy && adduser -S referralbuddy -G referralbuddy

WORKDIR /app

# Copy installed modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY src/ ./src/
COPY package.json ./

# Data directory — mount a volume here to persist the database
RUN mkdir -p /app/data && chown referralbuddy:referralbuddy /app/data

USER referralbuddy

# The database is persisted via a volume mount at /app/data
VOLUME ["/app/data"]

# Health check — verify the process is alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD pgrep -f "node src/index.js" > /dev/null || exit 1

CMD ["node", "src/index.js"]
