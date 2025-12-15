const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const inquirer = require('inquirer');
const chalk = require('chalk');
const Table = require('cli-table3');
const boxen = require('boxen');
const gradient = require('gradient-string');
const figlet = require('figlet');
const ora = require('ora');
const supabase = require('./supabase-config');
const crypto = require('crypto');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ ERROR: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}
const PORT = process.env.PORT || 3000;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const endpoints = new Map();
const app = express();
app.use(express.json());
app.use(express.static('public'));

// ═══════════════════════════════════════════════════════════
// 💾 FUNCIONES DE SUPABASE
// ═══════════════════════════════════════════════════════════

async function cargarEndpoints() {
  try {
    const { data, error } = await supabase
      .from('endpoints')
      .select('*')
      .order('createdAt', { ascending: false });
    
    if (error) throw error;
    
    if (data) {
      data.forEach(ep => {
        endpoints.set(ep.id, ep);
        
        const fullPath = '/api' + ep.path;
        const method = ep.method.toLowerCase();
        
        // Remover ruta existente si ya existe
        app._router.stack = app._router.stack.filter(r => {
          return !(r.route && r.route.path === fullPath && r.route.methods[method]);
        });
        
        // Si tiene schema, crear ruta dinámica que lea de endpoint_items
        if (ep.schema) {
          app[method](fullPath, async (req, res) => {
            const { data: items, error } = await supabase
              .from('endpoint_items')
              .select('*')
              .eq('endpoint_id', ep.id);
            
            if (error) {
              return res.status(500).json({ error: error.message });
            }
            
            res.json({
              success: true,
              data: items.map(item => ({ id: item.id, ...item.data })),
              total: items.length
            });
          });
        } else {
          // Si no tiene schema, usar responseData estático (endpoints viejos)
          app[method](fullPath, (req, res) => {
            res.json(ep.responseData);
          });
        }
        
        console.log(`✓ Loaded: ${ep.method} ${fullPath}${ep.schema ? ' (dynamic)' : ' (static)'}`);
      });
    }
    
    return endpoints.size;
  } catch (error) {
    console.error('Error loading endpoints:', error.message);
    return 0;
  }
}
async function guardarEndpoint(endpoint) {
  try {
    const { data, error } = await supabase
      .from('endpoints')
      .insert([endpoint])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(chalk.red('Error guardando endpoint:', error.message));
    return null;
  }
}

async function eliminarEndpointDB(id) {
  try {
    const { error } = await supabase
      .from('endpoints')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(chalk.red('Error eliminando endpoint:', error.message));
    return false;
  }
}

function mostrarBanner() {
  console.clear();
  const banner = figlet.textSync('KEBAPI', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted'
  });
  console.log(gradient.pastel.multiline(banner));
  console.log(chalk.cyan.bold('                  🌯 Generador de APIs REST con IA\n'));
  console.log(chalk.gray('                  Servidor: ') + chalk.green(`http://localhost:${PORT}`));
  console.log(chalk.gray('                  Database: ') + chalk.magenta(`Supabase ☁️\n`));
}

async function generarEndpoint() {
  console.clear();
  mostrarBanner();
  
  const { prompt } = await inquirer.prompt([
    {
      type: 'input',
      name: 'prompt',
      message: chalk.yellow('🌯 Describe el endpoint que quieres crear:'),
      validate: (input) => input.length >= 10 || chalk.red('Mínimo 10 caracteres')
    }
  ]);

  const spinner = ora({
    text: chalk.cyan('Cocinando tu endpoint con IA...'),
    color: 'cyan',
    spinner: 'dots'
  }).start();
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const aiPrompt = 'Crea un endpoint REST API en JSON para: ' + prompt + '. Formato: {"path": "/nombre", "method": "GET", "description": "...", "responseData": {"success": true, "data": [3 objetos con datos reales], "total": 3}}. Solo JSON, sin markdown.';

    const result = await model.generateContent(aiPrompt);
    const text = result.response.text();
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const endpoint = JSON.parse(cleanText);
    
    if (!endpoint.path.startsWith('/')) {
      endpoint.path = '/' + endpoint.path;
    }
    
    const endpointCompleto = {
      id: crypto.randomUUID(),
      ...endpoint,
      createdAt: new Date().toISOString(),
      originalPrompt: prompt
    };
    
    // Guardar en Supabase
    const saved = await guardarEndpoint(endpointCompleto);
    
    if (saved) {
      endpoints.set(saved.id, saved);
      
      const fullPath = '/api' + saved.path;
      app[saved.method.toLowerCase()](fullPath, (req, res) => {
        res.json(saved.responseData);
      });
      
      spinner.succeed(chalk.green.bold('✅ ¡Endpoint creado y guardado en Supabase!'));
      
      console.log('\n' + boxen(
        chalk.bold.white('🏷️  Método: ') + chalk.cyan(saved.method) + '\n' +
        chalk.bold.white('📍 Ruta: ') + chalk.yellow(fullPath) + '\n' +
        chalk.bold.white('📝 Descripción: ') + chalk.gray(saved.description) + '\n' +
        chalk.bold.white('🔗 URL Local: ') + chalk.blue.underline(`http://localhost:${PORT}${fullPath}`) + '\n' +
        chalk.bold.white('🌍 URL Cloud: ') + chalk.green.underline(`https://kebapi.up.railway.app${fullPath}`) + '\n' +
        chalk.bold.white('💾 Estado: ') + chalk.magenta('☁️  Guardado en Supabase'),
        {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor: 'green'
        }
      ));
    } else {
      spinner.fail(chalk.red.bold('❌ Error al guardar en Supabase'));
    }
    
  } catch (error) {
    spinner.fail(chalk.red.bold('❌ Error al generar endpoint'));
    console.log(chalk.red('\n' + error.message));
  }
}

function listarEndpoints() {
  console.clear();
  mostrarBanner();
  
  if (endpoints.size === 0) {
    console.log(boxen(
      chalk.yellow.bold('🍽️  El menú está vacío\n\n') +
      chalk.gray('Genera tu primer endpoint desde el menú principal'),
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'yellow'
      }
    ));
    return;
  }
  
  const table = new Table({
    head: [
      chalk.cyan.bold('N°'),
      chalk.cyan.bold('Método'),
      chalk.cyan.bold('Ruta'),
      chalk.cyan.bold('Descripción'),
      chalk.cyan.bold('Creado')
    ],
    colWidths: [5, 10, 30, 40, 20],
    style: {
      head: [],
      border: ['cyan']
    }
  });
  
  let index = 1;
  endpoints.forEach(ep => {
    const metodoBadge = {
      'GET': chalk.green('🟢 GET'),
      'POST': chalk.blue('🔵 POST'),
      'PUT': chalk.yellow('🟡 PUT'),
      'DELETE': chalk.red('🔴 DELETE')
    }[ep.method] || ep.method;
    
    const fecha = new Date(ep.createdAt).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    table.push([
      chalk.white(index++),
      metodoBadge,
      chalk.yellow('/api' + ep.path),
      chalk.gray(ep.description.substring(0, 35) + '...'),
      chalk.gray(fecha)
    ]);
  });
  
  console.log(table.toString());
  console.log('\n' + chalk.cyan.bold(`📊 Total de endpoints: ${endpoints.size}`));
  console.log(chalk.magenta(`☁️  Base de datos: Supabase`));
}

async function verDetalleEndpoint() {
  if (endpoints.size === 0) {
    console.log(chalk.yellow('\n⚠️  No hay endpoints para ver\n'));
    return;
  }
  
  const choices = Array.from(endpoints.values()).map((ep, i) => ({
    name: `${i + 1}. ${ep.method} /api${ep.path} - ${ep.description}`,
    value: ep
  }));
  
  const { endpoint } = await inquirer.prompt([
    {
      type: 'list',
      name: 'endpoint',
      message: chalk.yellow('Selecciona un endpoint para ver detalles:'),
      choices: choices
    }
  ]);
  
  console.clear();
  mostrarBanner();
  
  console.log(boxen(
    chalk.bold.cyan('🔍 DETALLES DEL ENDPOINT\n\n') +
    chalk.bold('Método: ') + chalk.green(endpoint.method) + '\n' +
    chalk.bold('Ruta: ') + chalk.yellow('/api' + endpoint.path) + '\n' +
    chalk.bold('Descripción: ') + chalk.gray(endpoint.description) + '\n' +
    chalk.bold('URL Local: ') + chalk.blue.underline(`http://localhost:${PORT}/api${endpoint.path}`) + '\n' +
    chalk.bold('URL Cloud: ') + chalk.green.underline(`https://kebapi.up.railway.app/api${endpoint.path}`) + '\n\n' +
    chalk.bold('Prompt original: ') + chalk.italic.gray(endpoint.originalPrompt) + '\n\n' +
    chalk.bold('Respuesta de ejemplo:\n') +
    chalk.dim(JSON.stringify(endpoint.responseData, null, 2)),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'double',
      borderColor: 'cyan'
    }
  ));
  
  console.log('\n' + chalk.gray('💡 Pruébalo: ') + chalk.white(`curl https://kebapi.up.railway.app/api${endpoint.path}`));
}

function mostrarEstadisticas() {
  console.clear();
  mostrarBanner();
  
  if (endpoints.size === 0) {
    console.log(chalk.yellow('\n⚠️  No hay estadísticas aún\n'));
    return;
  }
  
  const byMethod = {};
  endpoints.forEach(ep => {
    byMethod[ep.method] = (byMethod[ep.method] || 0) + 1;
  });
  
  const statsTable = new Table({
    head: [chalk.cyan.bold('Método HTTP'), chalk.cyan.bold('Cantidad')],
    colWidths: [20, 15],
    style: {
      head: [],
      border: ['cyan']
    }
  });
  
  Object.entries(byMethod).forEach(([method, count]) => {
    const emoji = {
      'GET': '🟢',
      'POST': '🔵',
      'PUT': '🟡',
      'DELETE': '🔴'
    }[method] || '⚪';
    
    statsTable.push([
      chalk.white(`${emoji} ${method}`),
      chalk.green.bold(count)
    ]);
  });
  
  console.log(boxen(
    chalk.cyan.bold('📊 ESTADÍSTICAS DE KEBAPI\n\n') +
    chalk.white('Total de endpoints: ') + chalk.green.bold(endpoints.size) + '\n\n' +
    statsTable.toString() + '\n\n' +
    chalk.white('☁️  Base de datos: ') + chalk.magenta('Supabase'),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan'
    }
  ));
}

async function eliminarEndpoint() {
  if (endpoints.size === 0) {
    console.log(chalk.yellow('\n⚠️  No hay endpoints para eliminar\n'));
    return;
  }
  
  const choices = Array.from(endpoints.values()).map((ep, i) => ({
    name: `${i + 1}. ${ep.method} /api${ep.path}`,
    value: ep
  }));
  
  choices.push({ name: chalk.gray('← Cancelar'), value: null });
  
  const { endpoint } = await inquirer.prompt([
    {
      type: 'list',
      name: 'endpoint',
      message: chalk.red('🗑️  Selecciona un endpoint para eliminar:'),
      choices: choices
    }
  ]);
  
  if (!endpoint) return;
  
  const { confirmar } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmar',
      message: chalk.yellow(`¿Estás seguro de eliminar ${endpoint.method} /api${endpoint.path}?`),
      default: false
    }
  ]);
  
  if (confirmar) {
    const deleted = await eliminarEndpointDB(endpoint.id);
    if (deleted) {
      endpoints.delete(endpoint.id);
      console.log(chalk.green.bold('\n✅ Endpoint eliminado de Supabase'));
      console.log(chalk.gray('💡 Reinicia Kebapi para limpiar las rutas de Express\n'));
    }
  }
}

async function menuPrincipal() {
  while (true) {
    console.clear();
    mostrarBanner();
    
    const { opcion } = await inquirer.prompt([
      {
        type: 'list',
        name: 'opcion',
        message: chalk.bold.white('¿Qué quieres hacer?'),
        choices: [
          { name: chalk.green('🌯 Generar nuevo endpoint'), value: 'generar' },
          { name: chalk.cyan('📋 Ver todos los endpoints'), value: 'listar' },
          { name: chalk.blue('🔍 Ver detalle de un endpoint'), value: 'detalle' },
          { name: chalk.magenta('📊 Ver estadísticas'), value: 'stats' },
          { name: chalk.red('🗑️  Eliminar endpoint'), value: 'eliminar' },
          new inquirer.Separator(),
          { name: chalk.gray('🚪 Salir'), value: 'salir' }
        ]
      }
    ]);
    
    switch (opcion) {
      case 'generar':
        await generarEndpoint();
        await inquirer.prompt([{ type: 'input', name: 'continuar', message: chalk.gray('\nPresiona Enter para continuar...') }]);
        break;
        
      case 'listar':
        listarEndpoints();
        await inquirer.prompt([{ type: 'input', name: 'continuar', message: chalk.gray('\nPresiona Enter para continuar...') }]);
        break;
        
      case 'detalle':
        await verDetalleEndpoint();
        await inquirer.prompt([{ type: 'input', name: 'continuar', message: chalk.gray('\nPresiona Enter para continuar...') }]);
        break;
        
      case 'stats':
        mostrarEstadisticas();
        await inquirer.prompt([{ type: 'input', name: 'continuar', message: chalk.gray('\nPresiona Enter para continuar...') }]);
        break;
        
      case 'eliminar':
        await eliminarEndpoint();
        await inquirer.prompt([{ type: 'input', name: 'continuar', message: chalk.gray('\nPresiona Enter para continuar...') }]);
        break;
        
      case 'salir':
        console.clear();
        console.log(gradient.rainbow('\n  ¡Gracias por usar KEBAPI! 🌯\n'));
        console.log(chalk.gray('  Hasta pronto...\n'));
        process.exit(0);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 🌐 API PARA CREAR ENDPOINTS DESDE LA WEB (CRUD COMPLETO)
// ═══════════════════════════════════════════════════════════

app.post('/api/create-endpoint', async (req, res) => {
  try {
    // Verificar autenticación
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required. Please sign in.'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({
        error: 'Invalid or expired token'
      });
    }

    const { prompt } = req.body;
    
    if (!prompt || prompt.length < 10) {
      return res.status(400).json({
        error: 'Prompt must be at least 10 characters'
      });
    }

    // Verificar límite de endpoints por usuario
    const { data: userEndpoints, error: countError } = await supabase
      .from('endpoints')
      .select('id')
      .eq('user_id', user.id);

    if (countError) throw countError;

    if (userEndpoints && userEndpoints.length >= 10) {
      return res.status(429).json({
        error: 'Limit reached: You can create up to 10 endpoints. Delete some to create new ones.'
      });
    }
    
    // Generar con Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const aiPrompt = `Create a REST API resource schema in JSON for: ${prompt}. 
    
    Return ONLY a JSON object with this EXACT structure:
    {
      "resourceName": "singular name (e.g. 'movie', 'recipe')",
      "resourceNamePlural": "plural name (e.g. 'movies', 'recipes')",
      "description": "brief description",
      "fields": [
        {"name": "field1", "type": "string", "required": true},
        {"name": "field2", "type": "number", "required": false}
      ],
      "sampleData": [
        {"field1": "value1", "field2": 123},
        {"field1": "value2", "field2": 456},
        {"field1": "value3", "field2": 789}
      ]
    }
    
    Only JSON, no markdown, no explanations.`;

    const result = await model.generateContent(aiPrompt);
    const text = result.response.text();
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const schema = JSON.parse(cleanText);
    
    // Crear endpoint principal
    const endpointId = crypto.randomUUID();
    const basePath = `/${schema.resourceNamePlural.toLowerCase()}`;
    
    const endpointCompleto = {
      id: endpointId,
      path: basePath,
      method: 'GET',
      description: schema.description,
      responseData: {
        success: true,
        data: schema.sampleData,
        total: schema.sampleData.length
      },
      user_id: user.id,
      createdAt: new Date().toISOString(),
      originalPrompt: prompt,
      schema: schema
    };
    
    // Guardar endpoint en Supabase
    const saved = await guardarEndpoint(endpointCompleto);
    
    if (!saved) {
      throw new Error('Error saving to Supabase');
    }

    // Insertar datos de ejemplo en endpoint_items
    for (const item of schema.sampleData) {
      await supabase
        .from('endpoint_items')
        .insert({
          endpoint_id: endpointId,
          user_id: user.id,
          data: item
        });
    }
    
    endpoints.set(endpointId, saved);
    
    // Registrar rutas CRUD
    const fullPath = '/api' + basePath;
    
    // GET /api/resources - Listar todos
    app.get(fullPath, async (req, res) => {
      const { data, error } = await supabase
        .from('endpoint_items')
        .select('*')
        .eq('endpoint_id', endpointId);
      
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      
      res.json({
        success: true,
        data: data.map(item => ({ id: item.id, ...item.data })),
        total: data.length
      });
    });
    
    // GET /api/resources/:id - Obtener uno
    app.get(`${fullPath}/:id`, async (req, res) => {
      const { data, error } = await supabase
        .from('endpoint_items')
        .select('*')
        .eq('endpoint_id', endpointId)
        .eq('id', req.params.id)
        .single();
      
      if (error) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      res.json({
        success: true,
        data: { id: data.id, ...data.data }
      });
    });
    
    // POST /api/resources - Crear nuevo
    app.post(fullPath, async (req, res) => {
      const { data, error } = await supabase
        .from('endpoint_items')
        .insert({
          endpoint_id: endpointId,
          user_id: user.id,
          data: req.body
        })
        .select()
        .single();
      
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      
      res.json({
        success: true,
        data: { id: data.id, ...data.data }
      });
    });
    
    // PUT /api/resources/:id - Actualizar
    app.put(`${fullPath}/:id`, async (req, res) => {
      const { data, error } = await supabase
        .from('endpoint_items')
        .update({ data: req.body })
        .eq('endpoint_id', endpointId)
        .eq('id', req.params.id)
        .select()
        .single();
      
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      
      res.json({
        success: true,
        data: { id: data.id, ...data.data }
      });
    });
    
    // DELETE /api/resources/:id - Eliminar
    app.delete(`${fullPath}/:id`, async (req, res) => {
      const { error } = await supabase
        .from('endpoint_items')
        .delete()
        .eq('endpoint_id', endpointId)
        .eq('id', req.params.id);
      
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      
      res.json({
        success: true,
        message: 'Deleted successfully'
      });
    });
    
    return res.json({
      success: true,
      endpoint: {
        ...saved,
        crud: {
          list: `GET ${fullPath}`,
          get: `GET ${fullPath}/:id`,
          create: `POST ${fullPath}`,
          update: `PUT ${fullPath}/:id`,
          delete: `DELETE ${fullPath}/:id`
        }
      }
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: error.message || 'Error generating endpoint'
    });
  }
});

// ═══════════════════════════════════════════════════════════
// 🌐 API REST ENDPOINTS
// ═══════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    endpoints: endpoints.size,
    timestamp: new Date().toISOString(),
    database: 'Supabase',
    ai: 'Gemini 2.5 Flash'
  });
});

app.get('/', (req, res) => {
  const endpointsList = Array.from(endpoints.values()).map(ep => ({
    method: ep.method,
    path: '/api' + ep.path,
    description: ep.description,
    url: `https://kebapi.up.railway.app/api${ep.path}`
  }));
  
  res.json({
    message: 'Kebapi API Generator',
    description: 'Create REST API endpoints using AI',
    endpoints: endpointsList,
    total: endpointsList.length,
    documentation: 'https://github.com/Stratos/kebapi'
  });
});

// ═══════════════════════════════════════════════════════════
// 🚀 INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════

async function iniciar() {
  const spinner = ora({
    text: chalk.cyan('Cargando Kebapi...'),
    color: 'cyan'
  }).start();
  
  const cargados = await cargarEndpoints();
  
  spinner.succeed(chalk.green('¡Listo!'));
  
  if (cargados > 0) {
    console.log(chalk.magenta(`☁️  ${cargados} endpoints cargados desde Supabase\n`));
  }
  
  app.listen(PORT, () => {
    console.log(chalk.green.bold(`\n🚀 Servidor iniciado en http://localhost:${PORT}`));
    console.log(chalk.cyan(`📚 Endpoints disponibles: ${endpoints.size}`));
    console.log(chalk.gray(`💡 Abre http://localhost:${PORT} en tu navegador\n`));
  });
  
  // Solo mostrar menú CLI si NO estamos en Railway
  if (!process.env.RAILWAY_ENVIRONMENT) {
    setTimeout(() => {
      menuPrincipal();
    }, 500);
  }
}
// ═══════════════════════════════════════════════════════════
// 🌍 MARKETPLACE – APIs públicas
// ═══════════════════════════════════════════════════════════

app.get('/api/marketplace', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('endpoints')
      .select(`
        id,
        path,
        method,
        description,
        createdAt,
        user_id,
        schema
      `)
      .eq('is_public', true)
      .order('createdAt', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      apis: data.map(ep => ({
        id: ep.id,
        method: ep.method,
        path: `/api${ep.path}`,
        description: ep.description,
        hasSchema: !!ep.schema,
        createdAt: ep.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


iniciar();