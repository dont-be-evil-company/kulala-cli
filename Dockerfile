FROM node:24-slim
ENV KULALA_CLI_VERSION=0.17.0

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl jq \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global --foreground-scripts --loglevel verbose @dont-be-evil-company/kulala-cli@${KULALA_CLI_VERSION}

ENTRYPOINT [ "kulala" ]
