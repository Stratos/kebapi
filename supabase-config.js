const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nugcshddtrufgciosrsq.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51Z2NzaGRkdHJ1ZmdjaW9zcnNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2NTUyMTMsImV4cCI6MjA4MTIzMTIxM30.1ECmZ8bG8HasOZ6pH_b3atPg6i9dxTRcPPUXehbiixY';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || supabaseAnonKey;

// Cliente para operaciones del servidor (con permisos completos)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Cliente para usuarios (con RLS)
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true
  }
});

module.exports = supabaseAdmin; // Exportar admin por defecto para el servidor
module.exports.supabase = supabase; // Exportar cliente normal también
