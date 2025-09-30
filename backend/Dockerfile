ARG APK_REPOSITORY_URL=https://dl-cdn.alpinelinux.org/alpine
ARG APK_ALLOW_INSECURE_MIRROR=false
ARG NPM_STRICT_SSL=true

FROM node:18-alpine
ARG APK_REPOSITORY_URL
ARG APK_ALLOW_INSECURE_MIRROR
ARG NPM_STRICT_SSL
WORKDIR /app
RUN set -eux; \
    SANITIZED_URL="${APK_REPOSITORY_URL:-https://dl-cdn.alpinelinux.org/alpine}"; \
    SANITIZED_URL="${SANITIZED_URL%/}"; \
    sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${SANITIZED_URL}|g" /etc/apk/repositories; \
    if ! apk add --no-cache ca-certificates curl; then \
      if [ "${APK_ALLOW_INSECURE_MIRROR}" = "true" ]; then \
        echo "Falling back to http APK repositories"; \
        sed -i 's|https://|http://|g' /etc/apk/repositories; \
        apk add --no-cache ca-certificates curl; \
      else \
        exit 1; \
      fi; \
    fi
ENV NPM_CONFIG_STRICT_SSL=$NPM_STRICT_SSL
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN chmod +x scripts/healthcheck.sh
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD /bin/sh /app/scripts/healthcheck.sh
EXPOSE 3001
CMD ["node", "server.js"]
