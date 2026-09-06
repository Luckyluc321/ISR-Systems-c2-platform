# ═════════════════════════════════════════════════════════════════════════
# ISR Systems · Vejdirektoratet AMQP Proxy — Scaleway serverless container
# ═════════════════════════════════════════════════════════════════════════

FROM node:20-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App code
COPY server.js ./

# Scaleway serverless containers pass PORT via env; default 8080
ENV PORT=8080
EXPOSE 8080

# Non-root
USER node

CMD ["node", "server.js"]
