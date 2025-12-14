const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nugcshddtrufgciosrsq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51Z2NzaGRkdHJ1ZmdjaW9zcnNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2NTUyMTMsImV4cCI6MjA4MTIzMTIxM30.1ECmZ8bG8HasOZ6pH_b3atPg6i9dxTRcPPUXehbiixY';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
