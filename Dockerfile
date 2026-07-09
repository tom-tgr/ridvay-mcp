# ridvay-mcp remote (streamable HTTP) — mcp.ridvay.com on Cloud Run.
# Same package as the npm stdio server; this image just runs the HTTP entrypoint.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 8080
# Per-request bearer auth — the container needs NO Ridvay API key of its own.
CMD ["node", "dist/http.js"]
