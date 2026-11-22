# Both screens in one image: Agent Cloud (apps/cloud) and the smart home app (apps/home), each a
# Next.js standalone server. docker-compose.yml runs it twice (cloud-web :3000, home-web :3001).
FROM node:24-slim AS build
WORKDIR /web
COPY package.json package-lock.json ./
COPY apps/cloud/package.json apps/cloud/
COPY apps/home/package.json apps/home/
COPY packages/ui/package.json packages/ui/
COPY packages/core/package.json packages/core/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx turbo run build --filter=cloud --filter=home

FROM node:24-slim
WORKDIR /srv
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
COPY --from=build /web/apps/cloud/.next/standalone ./cloud
COPY --from=build /web/apps/cloud/.next/static ./cloud/apps/cloud/.next/static
COPY --from=build /web/apps/home/.next/standalone ./home
COPY --from=build /web/apps/home/.next/static ./home/apps/home/.next/static
EXPOSE 3000 3001
CMD ["node", "cloud/apps/cloud/server.js"]
