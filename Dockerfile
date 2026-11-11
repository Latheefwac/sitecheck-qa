# Sitecheck QA — one long-running container with Playwright browsers and a persistent /data volume.
# The Playwright image ships Chromium, Firefox and WebKit plus their system libraries.
# Its tag must match the "playwright" version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.65.0-noble AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies (build tools in case better-sqlite3 has no prebuilt binary for this Node version)
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# Build, then drop dev dependencies
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime
FROM base AS run
ENV NODE_ENV=production \
    QA_DATA_DIR=/data \
    PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json /app/next.config.ts ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["docker-entrypoint.sh"]
