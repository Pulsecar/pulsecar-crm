FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
ENV NODE_ENV=production DB_PATH=/data/pulsecar.db PORT=3100
VOLUME /data
EXPOSE 3100
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
