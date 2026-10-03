FROM node:20-slim
WORKDIR /app

# Build tools as a fallback in case better-sqlite3 needs compiling
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

EXPOSE 8787
CMD ["node", "server/index.js"]
