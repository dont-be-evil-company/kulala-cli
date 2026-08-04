FROM node:24-slim
ENV KULALA_CLI_VERSION=0.14.1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl jq \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global --foreground-scripts --loglevel verbose @mistweaverco/kulala-cli@${KULALA_CLI_VERSION}

ENTRYPOINT [ "kulala" ]
