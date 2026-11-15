-- Миграция: добавить поле is_visible в таблицу games
-- Запустить в Supabase → SQL Editor

ALTER TABLE games ADD COLUMN IF NOT EXISTS is_visible INTEGER DEFAULT 1;

-- Игра от 30.05.2026 — скрыть (история)
UPDATE games SET is_visible = 0 WHERE name LIKE 'Игра 30.05.2026%';

-- Игра от 14.11.2026 — показывать
UPDATE games SET is_visible = 1 WHERE name LIKE 'Игра 14.11.2026%';
