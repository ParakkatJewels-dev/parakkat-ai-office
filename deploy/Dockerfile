FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY deploy/fonts/DejaVuSans.ttf deploy/fonts/DejaVuSerif.ttf /usr/share/fonts/truetype/dejavu/
COPY deploy/fonts/fonts.conf /etc/fonts/fonts.conf
COPY deploy/fonts/copyright /usr/share/doc/parakkat-fonts/copyright
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV CHATGPT_AUTH_DIR=/var/lib/parakkat-ai-office/chatgpt
ENV GEMINI_CONFIG_DIR=/var/lib/parakkat-ai-office/provider-secrets
RUN mkdir -p /var/lib/parakkat-ai-office/chatgpt /var/lib/parakkat-ai-office/provider-secrets && chown -R node:node /var/lib/parakkat-ai-office && chmod 700 /var/lib/parakkat-ai-office/chatgpt /var/lib/parakkat-ai-office/provider-secrets
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src/lib/chatgpt ./src/lib/chatgpt
COPY --from=build --chown=node:node /app/src/lib/llm ./src/lib/llm
COPY --from=build --chown=node:node /app/deploy ./deploy
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
