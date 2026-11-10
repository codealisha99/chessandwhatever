# --- build the SPA ---
FROM node:24-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- runtime: Node runs the TypeScript server directly (type stripping) ---
FROM node:24-alpine
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/frontend/dist
WORKDIR /app/backend1
COPY backend1/package.json backend1/package-lock.json ./
RUN npm ci --omit=dev
COPY backend1/src ./src
COPY --from=web /app/frontend/dist /app/frontend/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:8080/api/health || exit 1
CMD ["node", "src/index.ts"]
