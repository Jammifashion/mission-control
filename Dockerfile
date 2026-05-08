FROM node:24-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --only=production
COPY backend/ ./backend/
EXPOSE 8080
ENV PORT=8080
CMD ["node", "backend/index.js"]
