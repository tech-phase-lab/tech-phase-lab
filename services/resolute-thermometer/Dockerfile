FROM node:24.22.1-bookworm-slim
WORKDIR /app
# Reuse the resolute-api lockfile: the worker only needs `pg`.
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY lib/resolute/thermometer*.ts lib/resolute/thermometer-rosters.json ./lib/resolute/
COPY lib/research/us-market-session.ts ./lib/research/us-market-session.ts
COPY scripts/resolute/refresh-thermometer.mts scripts/resolute/provision-thermometer.mjs scripts/resolute/thermometer-schema.sql ./scripts/resolute/
USER node
ENV NODE_ENV=production
# Without credentials the worker reports `disabled` and exits 0; this loads the whole dependency graph.
RUN RESOLUTE_THERMOMETER_COLLECT_ENABLED=0 node --experimental-strip-types scripts/resolute/refresh-thermometer.mts \
 && node --experimental-strip-types scripts/resolute/provision-thermometer.mjs
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "600s", "node", "--experimental-strip-types", "scripts/resolute/refresh-thermometer.mts"]
