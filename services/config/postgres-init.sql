-- Run once by the postgres container on an empty volume (docker-compose.yml). POSTGRES_DB makes
-- the Agent Hub's database; Studio gets its own.
CREATE DATABASE studio;
