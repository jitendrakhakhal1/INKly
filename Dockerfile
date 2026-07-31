FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY index.html app.js style.css server.js razorpay-config.example.json README.md ./

ENV NODE_ENV=production
ENV PORT=3000
ENV STORAGE_DIR=/app/storage

RUN mkdir -p /app/storage \
  && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "server.js"]
