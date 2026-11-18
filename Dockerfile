# One Sicht node. The models are loaded on first start into the mounted /srv/.models volume;
# afterwards the container runs without network access (SICHT_OFFLINE=1).
#
#   docker build -t sicht .
#   docker run -p 8787:8787 -v sicht-data:/srv/data -v sicht-models:/srv/.models -v sicht-scenarios:/srv/scenarios sicht
#
# The exercise footage is not part of the image (its licence forbids redistribution as files).
# Fetch it once into the scenarios volume, then restart the container:
#
#   docker run --rm -v sicht-scenarios:/srv/scenarios sicht node apps/server/dist/scripts/fetchFootage.js
#
# State of verification: in a test build both stages ran through the dependency installation and
# all copy steps; the last layer and a start inside a container were not run (the test machine's
# layer store ran full). The same layout, with production dependencies only, was started outside
# a container without network access and served the console.

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
RUN mkdir -p /srv/data /srv/.models && chown -R node:node /srv/data /srv/.models /srv/scenarios
VOLUME ["/srv/data", "/srv/.models", "/srv/scenarios"]
EXPOSE 8787
USER node
CMD ["node", "apps/server/dist/index.js"]
