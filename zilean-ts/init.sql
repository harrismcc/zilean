-- Enable pg_trgm extension for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Set trigram similarity threshold
SET pg_trgm.similarity_threshold = 0.3;
