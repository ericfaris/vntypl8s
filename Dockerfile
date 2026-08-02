# VNTYPL8S — single image: builds shared + client + server, runs the Node
# server which serves the built client and the Socket.IO endpoint.
# Stays on node:22-slim to match pinpoint even though the dev host runs 24 —
# Docker is what actually ships.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
