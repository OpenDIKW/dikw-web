-- Runs once on first Postgres start (/docker-entrypoint-initdb.d convention).
-- The pgvector image bundles the extension files, but CREATE EXTENSION still
-- has to fire per-database. Mirrors dikw-core's examples/docker/pg-init.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
