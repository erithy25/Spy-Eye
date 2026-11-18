# One Sicht node. The models are loaded on first start into the mounted /srv/.models volume;
# afterwards the container runs without network access (SICHT_OFFLINE=1).
#
#   docker build -t sicht .
#   docker run -p 8787:8787 -v sicht-data:/srv/data -v sicht-models:/srv/.models sicht

FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /srv
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps apps
RUN pnpm build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /srv
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @sicht/server...
COPY --from=build /srv/apps/server/dist apps/server/dist
COPY --from=build /srv/apps/web/dist apps/web/dist
COPY apps/server/assets apps/server/assets
COPY scenarios scenarios
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/srv/data MODEL_CACHE_DIR=/srv/.models
RUN mkdir -p /srv/data /srv/.models && chown -R node:node /srv/data /srv/.models
VOLUME ["/srv/data", "/srv/.models"]
EXPOSE 8787
USER node
CMD ["node", "apps/server/dist/index.js"]
