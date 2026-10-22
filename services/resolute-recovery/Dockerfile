FROM node:24.22.1-bookworm-slim AS dependencies
WORKDIR /app
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
FROM postgres:18-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json ./package.json
COPY services/resolute-api/ ./services/resolute-api/
COPY services/resolute-protection/ ./services/resolute-protection/
COPY services/resolute-recovery/ ./services/resolute-recovery/
COPY lib/resolute/ ./lib/resolute/
COPY lib/membership/entitlements.ts ./lib/membership/entitlements.ts
COPY scripts/resolute/protection.py ./scripts/resolute/protection.py
COPY db/resolute/ ./db/resolute/
ENV PGDATA="" PG_MAJOR="" PG_VERSION=""
USER postgres
ENTRYPOINT []
CMD ["node", "services/resolute-recovery/cli.mjs"]
