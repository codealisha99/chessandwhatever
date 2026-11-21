# Game server for the Cloudflare Container (the SPA is served by the Worker's static assets).
# Redis runs in the same container: it only holds live state (games, queues); accounts and finished games are in Neon.
FROM node:24-alpine
RUN apk add --no-cache redis
# Node tries each DNS address for only 250ms by default; too short for far-away Postgres hosts
ENV NODE_ENV=production NODE_OPTIONS=--network-family-autoselection-attempt-timeout=1000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 8080
CMD ["sh", "-c", "redis-server --save '' --appendonly no --daemonize yes && exec node src/index.ts"]
