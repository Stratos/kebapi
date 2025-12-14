const supabase = require('./supabase-config');

async function setupTable() {
  console.log('🔧 Configurando tabla en Supabase...\n');
  
  // Verificar si la tabla existe intentando leer
  const { data, error } = await supabase
    .from('endpoints')
    .select('*')
    .limit(1);
  
  if (error && error.code === '42P01') {
    console.log('⚠️  La tabla "endpoints" no existe.');
    console.log('\n📝 Por favor, crea la tabla manualmente en Supabase:');
    console.log('\n1. Ve a: https://supabase.com/dashboard/project/nugcshddtrufgciosrsq/editor');
    console.log('2. Click en "New table"');
    console.log('3. Name: endpoints');
    console.log('4. Desmarca "Enable Row Level Security"');
    console.log('5. Columnas:');
    console.log('   - id (uuid, primary, auto)');
    console.log('   - path (text)');
    console.log('   - method (text)');
    console.log('   - description (text)');
    console.log('   - responseData (jsonb)');
    console.log('   - originalPrompt (text)');
    console.log('   - createdAt (timestamptz, default: now())');
    console.log('\n6. Click "Save"\n');
  } else if (error) {
    console.error('❌ Error:', error.message);
  } else {
    console.log('✅ Tabla "endpoints" existe y está lista!');
    console.log(`📊 Endpoints actuales: ${data ? data.length : 0}\n`);
  }
}

setupTable();
