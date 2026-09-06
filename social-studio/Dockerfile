FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache dumb-init ffmpeg
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
RUN mkdir -p /app/data/uploads && chown -R node:node /app
USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
