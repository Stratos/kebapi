-- Tabla para almacenar items de endpoints
CREATE TABLE IF NOT EXISTS endpoint_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID REFERENCES endpoints(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS endpoint_items_endpoint_id_idx ON endpoint_items(endpoint_id);
CREATE INDEX IF NOT EXISTS endpoint_items_user_id_idx ON endpoint_items(user_id);

-- RLS
ALTER TABLE endpoint_items ENABLE ROW LEVEL SECURITY;

-- Políticas: usuarios ven sus propios items
CREATE POLICY "Users can view own items"
ON endpoint_items FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own items"
ON endpoint_items FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own items"
ON endpoint_items FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own items"
ON endpoint_items FOR DELETE
USING (auth.uid() = user_id);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_endpoint_items_updated_at
    BEFORE UPDATE ON endpoint_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
