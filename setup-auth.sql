-- Agregar columna de user_id a endpoints
ALTER TABLE endpoints 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Crear índice para mejorar performance
CREATE INDEX IF NOT EXISTS endpoints_user_id_idx ON endpoints(user_id);

-- Habilitar RLS (Row Level Security)
ALTER TABLE endpoints ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes si las hay
DROP POLICY IF EXISTS "Users can view own endpoints" ON endpoints;
DROP POLICY IF EXISTS "Users can create own endpoints" ON endpoints;
DROP POLICY IF EXISTS "Users can delete own endpoints" ON endpoints;

-- Política: Los usuarios solo ven sus propios endpoints
CREATE POLICY "Users can view own endpoints"
ON endpoints FOR SELECT
USING (auth.uid() = user_id);

-- Política: Los usuarios solo crean sus propios endpoints
CREATE POLICY "Users can create own endpoints"
ON endpoints FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Política: Los usuarios solo pueden eliminar sus propios endpoints
CREATE POLICY "Users can delete own endpoints"
ON endpoints FOR DELETE
USING (auth.uid() = user_id);

-- Crear tabla de límites por usuario
CREATE TABLE IF NOT EXISTS user_limits (
  user_id UUID REFERENCES auth.users(id) PRIMARY KEY,
  endpoints_created INTEGER DEFAULT 0,
  last_generation TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- RLS para user_limits
ALTER TABLE user_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own limits"
ON user_limits FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own limits"
ON user_limits FOR UPDATE
USING (auth.uid() = user_id);
