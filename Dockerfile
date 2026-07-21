# Single-image build: builds the client, then runs the server which serves it.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install
COPY . .
RUN npm run build --workspace client

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
# Persistence lives in a hosted Turso database — set DATABASE_URL and
# DATABASE_AUTH_TOKEN as env vars / secrets on the host. Without them the server
# falls back to a local (ephemeral) SQLite file.
ENV COOKIE_SECURE=true
EXPOSE 3001
CMD ["npm", "run", "start", "--workspace", "server"]
