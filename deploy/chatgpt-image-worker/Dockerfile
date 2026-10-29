FROM node:22-bookworm-slim

# Export the official Node image's bundled Mozilla trust roots for native TLS.
# This avoids a separate package-repository bootstrap and keeps TLS verification on.
RUN mkdir -p /etc/ssl/certs \
    && node -e 'require("node:fs").writeFileSync("/etc/ssl/certs/ca-certificates.crt", require("node:tls").rootCertificates.join("\n") + "\n", { mode: 0o644 })' \
    && test -s /etc/ssl/certs/ca-certificates.crt

# This image is independent of the AI Office runtime and its credentials.
RUN npm install --global --no-audit --no-fund @openai/codex@0.165.0 \
    && npm cache clean --force \
    && codex --version \
    && install -d -m 0700 -o node -g node /var/lib/parakkat-chatgpt-images/codex /work

COPY --chown=root:root worker-core.mjs worker.mjs pilot.mjs /opt/chatgpt-image-worker/
RUN chmod 0555 /opt/chatgpt-image-worker \
    && chmod 0444 /opt/chatgpt-image-worker/*.mjs

ENV CODEX_HOME=/var/lib/parakkat-chatgpt-images/codex
ENV LANG=C.UTF-8
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
WORKDIR /work
USER node:node

# No host or application environment is forwarded to the default CLI process.
# Explicit pilot.mjs execution also uses a whitelist for its Codex subprocess.
ENTRYPOINT ["env", "-i", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "CODEX_HOME=/var/lib/parakkat-chatgpt-images/codex", "LANG=C.UTF-8", "SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt", "codex", "-c", "forced_login_method=\"chatgpt\"", "-c", "cli_auth_credentials_store=\"file\"", "-c", "features.image_generation=true", "-c", "features.apps=false"]
CMD ["--help"]
