# Web app image (Next.js 15 BFF + dashboard). Build context is the REPO ROOT
# (monorepo workspaces):
#   docker build -f apps/web/Dockerfile .
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages
# The eval-loop route statically imports the committed eval artifact.
COPY models/registry ./models/registry
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @hackguard/web

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/apps/web ./apps/web
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/models ./models
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@hackguard/web"]
