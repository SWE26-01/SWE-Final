FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY common common
COPY homeconfig homeconfig
COPY gateway gateway
COPY collector collector
COPY config config
RUN pip install --no-cache-dir -e .
