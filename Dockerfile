FROM node:12.18.1-alpine

LABEL version="1.2.1"
LABEL repository="https://github.com/prescottprue/deploy-changed"
LABEL homepage="https://github.com/prescottprue/deploy-changed"
LABEL maintainer="Prescott Prue <prescottprue@github.com>"

LABEL com.github.actions.name="GitHub Action for Deploying Changed Functions"
LABEL com.github.actions.description="Deploys only Firebase functions which have changed."
LABEL com.github.actions.icon="package"
LABEL com.github.actions.color="gray-dark"

# git is now required when install firebase-tools
RUN apk update && apk upgrade && apk add --no-cache git

RUN npm install -g firebase-tools

COPY LICENSE README.md /
COPY "dist" "."

ENTRYPOINT ["node", "./dist/index.js"]
CMD ["--help"]