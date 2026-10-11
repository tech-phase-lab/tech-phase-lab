FROM node:24-bookworm-slim
WORKDIR /app
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/resolute-api/*.mjs ./services/resolute-api/
COPY lib/resolute/*.ts ./lib/resolute/
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "services/resolute-api/index.mjs"]
