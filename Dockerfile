FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY tsconfig.json ./

COPY src ./src
RUN yarn build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn workspaces focus -A --production

COPY --from=build /app/dist ./dist

CMD ["yarn", "start:api"]
