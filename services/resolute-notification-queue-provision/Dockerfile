FROM node:24.22.1-bookworm-slim
WORKDIR /app
# Only `pg` is needed: reuse the resolute-api lockfile.
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/resolute/provision-notification-queue.mjs ./scripts/resolute/provision-notification-queue.mjs
USER node
ENV NODE_ENV=production
# Inert unless RESOLUTE_PROVISION_NOTIFICATION_QUEUE=true is set on the (temporary) service; otherwise it prints DISABLED and exits 0.
RUN node scripts/resolute/provision-notification-queue.mjs
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "120s", "node", "scripts/resolute/provision-notification-queue.mjs"]
