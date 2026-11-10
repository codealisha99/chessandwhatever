# Game server only (the SPA is deployed separately, e.g. on Vercel).
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/index.ts"]
