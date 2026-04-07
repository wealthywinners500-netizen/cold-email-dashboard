FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY dist/ ./dist/

ENV NODE_ENV=production

CMD ["node", "dist/worker/index.js"]
