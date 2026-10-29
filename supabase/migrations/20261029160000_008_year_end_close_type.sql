-- PEP ERP — Migration 008 (Blueprint Phase 1): journal type for the year-end closing journal.
-- Separate file: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE journal_type ADD VALUE IF NOT EXISTS 'year_end_close';
