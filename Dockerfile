FROM node:20-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=9090

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
COPY public/ ./public/
COPY bench/ ./bench/

EXPOSE 3000 9090

CMD ["node", "src/master.js"]
