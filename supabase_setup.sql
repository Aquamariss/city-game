-- Запустить в Supabase → SQL Editor

CREATE TABLE IF NOT EXISTS games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  data JSONB DEFAULT '{}'::jsonb
);

-- Разрешить чтение/запись без авторизации (anon key)
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON games
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
