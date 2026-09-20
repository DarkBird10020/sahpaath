# syntax=docker/dockerfile:1
############################
# Stage 1 — build
############################
# public.ecr.aws mirror of node:24-bookworm-slim: no Docker Hub rate limits
# and pullable from inside AWS without credentials.
FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS build
WORKDIR /app

# Install everything (dev deps are needed: tsc + vite + tsx).
COPY package.json package-lock.json ./
RUN npm ci

# Full source for the project-wide tsc --noEmit typecheck, then the SPA build.
# .dockerignore keeps .git/.data/logs/dist out of the context.
COPY . .

# Public-by-design Supabase values baked into the SPA bundle at build time.
# Only the publishable/anon key (safe for frontend code) is passed here —
# server secrets live in Secrets Manager and NEVER enter the image build.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

############################
# Stage 2 — runtime
############################
FROM public.ecr.aws/docker/library/node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    SAHPAATH_DATA_DIR=/data
WORKDIR /app

# Data directory (sqlite legacy sessions, OCR cache). In ECS this path is an
# EFS mount so sessions survive task replacement.
RUN mkdir -p /data && chown node:node /data

# Single copy from the build stage: built SPA (dist/), server sources, and
# node_modules including tsx, which the project's `npm start` runs with.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000

# curl/wget are not in the slim image; node's own fetch does the healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Serves dist/ + the API, no vite (what `npm start` runs).
# Run node directly (not through npm) so a deploy's SIGTERM reaches the server, which
# then finishes in-flight requests and exits cleanly instead of being killed.
CMD ["node", "--import", "tsx", "server/index.ts", "--production"]
