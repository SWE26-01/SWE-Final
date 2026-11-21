-- Run once by the postgres container on an empty volume (docker-compose.yml). POSTGRES_DB makes
-- the Agent Hub's database; Studio and the Collector get their own. Each service also creates its
-- database at startup if it is missing (common/db.py `ensure_database`), for older volumes.
CREATE DATABASE studio;
CREATE DATABASE collector;
