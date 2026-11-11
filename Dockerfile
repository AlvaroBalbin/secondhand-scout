FROM node:22-alpine
WORKDIR /scout
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY vendor ./vendor
USER node
EXPOSE 4317
CMD ["node", "scripts/dev.mjs", "--hosted"]
