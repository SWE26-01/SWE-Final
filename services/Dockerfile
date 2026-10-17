FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY ambient ambient
COPY homeconfig homeconfig
COPY agents agents
COPY gateway gateway
COPY collector collector
COPY config config
RUN pip install --no-cache-dir .
