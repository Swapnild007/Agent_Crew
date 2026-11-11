FROM node:24-trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap ca-certificates git util-linux \
    && rm -rf /var/lib/apt/lists/*
USER node
