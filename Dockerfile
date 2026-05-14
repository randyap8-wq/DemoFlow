# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# DemoFlow — multi-stage container build
#
# Stage 1 ("build") installs deps and produces a static Vite bundle in /app/dist.
# Stage 2 ("runtime") serves that bundle with Nginx on port 8080 (non-root).
#
# Build:  docker build -t demoflow .
# Run:    docker run --rm -p 8080:8080 demoflow
# Open:   http://localhost:8080
# ---------------------------------------------------------------------------

# ---- Stage 1: build -------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source and build. BASE_PATH can be overridden at build time for
# sub-path deployments (e.g. GitHub Pages): --build-arg BASE_PATH=/DemoFlow/
ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}
COPY . .
RUN npm run build

# ---- Stage 2: runtime -----------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Custom config: listens on 8080, gzips assets, falls back to index.html for
# client-side routing.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Drop the default Nginx assets and copy the built bundle in.
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
