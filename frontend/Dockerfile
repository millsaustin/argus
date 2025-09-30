# syntax=docker/dockerfile:1
ARG APK_REPOSITORY_URL=https://dl-cdn.alpinelinux.org/alpine
ARG APK_ALLOW_INSECURE_MIRROR=false

FROM node:18-alpine AS deps
ARG APK_REPOSITORY_URL
ARG APK_ALLOW_INSECURE_MIRROR
ARG NPM_STRICT_SSL=true
ENV NPM_CONFIG_STRICT_SSL=$NPM_STRICT_SSL
WORKDIR /app
RUN set -eux; \
    SANITIZED_URL="${APK_REPOSITORY_URL:-https://dl-cdn.alpinelinux.org/alpine}"; \
    SANITIZED_URL="${SANITIZED_URL%/}"; \
    sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${SANITIZED_URL}|g" /etc/apk/repositories; \
    if ! apk add --no-cache ca-certificates; then \
      if [ "${APK_ALLOW_INSECURE_MIRROR}" = "true" ]; then \
        echo "Falling back to http APK repositories"; \
        sed -i 's|https://|http://|g' /etc/apk/repositories; \
        apk add --no-cache ca-certificates; \
      else \
        exit 1; \
      fi; \
    fi
COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
      npm ci --legacy-peer-deps; \
    else \
      npm install --legacy-peer-deps; \
    fi

FROM node:18-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
