# The five OpenClaw agents in one container (scripts/run_agents.sh), so their peer URLs
# (127.0.0.1:<port>, agents/shared.json5) keep working. Built from the repo root (docker-compose.yml).
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends rsync curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g openclaw@2026.10.4 pnpm@10 && npm cache clean --force
WORKDIR /repo
COPY agents/home-a2a-plugin/package.json agents/home-a2a-plugin/pnpm-lock.yaml agents/home-a2a-plugin/
RUN cd agents/home-a2a-plugin && pnpm install --frozen-lockfile --prod
COPY agents agents
COPY scripts/oc.sh scripts/run_agents.sh scripts/launcher.mjs scripts/
ENV AGENT_HOME=/state OPENCLAW_BIND=lan LAUNCHER_HOST=0.0.0.0
CMD ["scripts/run_agents.sh"]
