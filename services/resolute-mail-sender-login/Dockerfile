FROM node:24.22.1-bookworm-slim
WORKDIR /app
# Only `pg` is needed: reuse the resolute-api lockfile.
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/resolute/enable-mail-sender-login.mjs ./scripts/resolute/enable-mail-sender-login.mjs
USER node
ENV NODE_ENV=production
# Inert unless RESOLUTE_ENABLE_MAIL_SENDER_LOGIN=true is set on the (temporary) service; otherwise it prints DISABLED and exits 0.
RUN node scripts/resolute/enable-mail-sender-login.mjs
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "120s", "node", "scripts/resolute/enable-mail-sender-login.mjs"]
