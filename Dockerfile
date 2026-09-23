FROM node:24-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --only=production
COPY backend/ ./backend/
EXPOSE 8080
ENV PORT=8080
# Stand des Codes fuer GET /health (backend/utils/stand.js). Kommt als Build-Arg
# aus deploy-backend.yml und gehoert damit zum Image, nicht zur Revision.
# Ohne Build-Arg (lokaler Build) meldet /health "unbekannt".
ARG MC_COMMIT=
ARG MC_GEBAUT=
ENV MC_COMMIT=$MC_COMMIT MC_GEBAUT=$MC_GEBAUT
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
USER appuser
CMD ["node", "backend/index.js"]
