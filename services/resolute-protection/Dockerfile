FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY lib/resolute/protection-ledger.ts ./lib/resolute/protection-ledger.ts
COPY services/resolute-protection/server.mjs ./services/resolute-protection/server.mjs
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "services/resolute-protection/server.mjs"]
