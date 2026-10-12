FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://${HOST:-127.0.0.1}:${PORT:-3010}/healthz || exit 1
CMD ["node", "src/server.js"]
