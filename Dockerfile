FROM node:25-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

ARG BUILD_VERSION=0
ARG BUILD_SHA=dev
RUN echo "{\"version\":\"$BUILD_VERSION\",\"sha\":\"$BUILD_SHA\"}" > public/assets/version.json

RUN npx ng build --configuration=production

FROM nginx:alpine AS runtime

# Security headers and gzip via nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/qb-engineer-ui/browser /usr/share/nginx/html

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

EXPOSE 80
