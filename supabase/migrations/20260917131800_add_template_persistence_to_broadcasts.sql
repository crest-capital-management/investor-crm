-- Migration: Add template persistence and variable mappings to broadcasts
-- Created: 2026-09-17
-- Description:
--   1. Adds nullable template_id UUID foreign key referencing templates(id) ON DELETE SET NULL
--   2. Adds nullable variable_mappings JSONB column defaulting to '{}'
--   3. Adds an index on template_id for performant lookups
--   4. Preserves full backward compatibility for existing free-form and draft/scheduled broadcasts

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variable_mappings JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_broadcasts_template_id ON broadcasts(template_id);
