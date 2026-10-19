FROM node:24-bookworm-slim
WORKDIR /app
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/resolute-api/*.mjs ./services/resolute-api/
COPY services/resolute-api/payments/ ./services/resolute-api/payments/
COPY lib/resolute/*.ts ./lib/resolute/
COPY lib/membership/entitlements.ts ./lib/membership/entitlements.ts
COPY lib/research/ ./lib/research/
COPY scripts/research/mu_fq4_recovery.json scripts/research/sources.json ./scripts/research/
USER node
ENV NODE_ENV=production PORT=3000
# Load the complete worker dependency graph without credentials, I/O or model calls.
RUN RESOLUTE_RIZEL_DAILY_REVIEW_ENABLED=false node services/resolute-api/rizel-daily-review-cli.mjs
EXPOSE 3000
CMD ["node", "services/resolute-api/index.mjs"]
