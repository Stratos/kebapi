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
app.use(express.json({ limit: '50mb' })); // Aumentar límite para datasets grandes
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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
        
        // Nueva estructura: /api/{project_name}/{endpoint_name}
        const fullPath = `/api/${ep.project_name}${ep.path}`;
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

    const { prompt, project_name } = req.body;
    
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
    
    // Usar project_name del request o generar uno basado en el schema
    const projectName = project_name || schema.resourceName.toLowerCase();
    
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
      project_name: projectName,
      user_id: user.id,
      user_email: user.email,
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
    
    // Registrar rutas CRUD con nueva estructura
    const fullPath = `/api/${projectName}${basePath}`;
    
    // GET /api/{project}/{resources} - Listar todos
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
    
    // GET /api/{project}/{resources}/:id - Obtener uno
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
// 🌍 MARKETPLACE API (APIs públicas)
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
        user_email,
        project_name
      `)
      .eq('published', true)
      .order('createdAt', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({
      success: true,
      apis: data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 📊 CREATE API FROM DATASET
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 📚 KNOWLEDGE BASE ENDPOINTS
// ═══════════════════════════════════════════════════════════

// List user's datasets
app.get('/api/datasets', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: datasets, error } = await supabase
      .from('datasets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      datasets: datasets || []
    });

  } catch (error) {
    console.error('Error fetching datasets:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get dataset items
app.get('/api/datasets/:datasetId/items', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { datasetId } = req.params;

    // Verify ownership
    const { data: dataset } = await supabase
      .from('datasets')
      .select('*')
      .eq('id', datasetId)
      .eq('user_id', user.id)
      .single();

    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    const { data: items } = await supabase
      .from('dataset_items')
      .select('*')
      .eq('dataset_id', datasetId);

    res.json({
      success: true,
      items: items || []
    });

  } catch (error) {
    console.error('Error fetching dataset items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete dataset
app.delete('/api/datasets/:datasetId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { datasetId } = req.params;

    // Verify ownership and delete
    const { error } = await supabase
      .from('datasets')
      .delete()
      .eq('id', datasetId)
      .eq('user_id', user.id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Dataset deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting dataset:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/create-from-dataset', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { 
      project_name, 
      api_name, 
      schema, 
      data, 
      description,
      save_to_kb,
      dataset_name,
      file_name,
      file_size,
      source_type,
      dataset_id // Si viene de un dataset existente
    } = req.body;

    if (!project_name || !api_name || !schema || !data) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const path = `/${api_name}`;
    const method = 'GET';

    let finalDatasetId = dataset_id;

    // 0. Si save_to_kb es true, guardar dataset primero
    console.log('📊 save_to_kb:', save_to_kb, 'dataset_id:', dataset_id);
    
    if (save_to_kb && !dataset_id) {
      console.log('💾 Guardando dataset en Knowledge Base...');
      const sampleData = data.slice(0, 5);
      
      const { data: newDataset, error: datasetError } = await supabase
        .from('datasets')
        .insert({
          user_id: user.id,
          user_email: user.email,
          name: dataset_name || api_name,
          description: description || `Dataset for ${api_name}`,
          file_name: file_name || 'upload',
          file_size: file_size || 0,
          row_count: data.length,
          schema: schema,
          sample_data: sampleData,
          source_type: source_type || 'upload',
          source_url: null
        })
        .select()
        .single();

      if (datasetError) {
        console.error('❌ Error creating dataset:', datasetError);
        console.error('Details:', JSON.stringify(datasetError, null, 2));
        // Continue anyway, don't fail
      } else {
        console.log('✅ Dataset created:', newDataset.id);
        finalDatasetId = newDataset.id;
        
        // Guardar items del dataset
        const datasetItems = data.map(item => ({
          dataset_id: newDataset.id,
          data: item
        }));

        console.log(`💾 Guardando ${datasetItems.length} items del dataset...`);

        // Insert in chunks
        const chunkSize = 1000;
        for (let i = 0; i < datasetItems.length; i += chunkSize) {
          const chunk = datasetItems.slice(i, i + chunkSize);
          const { error: itemsError } = await supabase.from('dataset_items').insert(chunk);
          if (itemsError) {
            console.error('❌ Error inserting dataset items:', itemsError);
          } else {
            console.log(`✅ Inserted chunk ${i / chunkSize + 1}`);
          }
        }
        
        console.log('✅ Dataset completo guardado en KB');
      }
    } else {
      console.log('⏭️ Skipping KB save (save_to_kb:', save_to_kb, 'dataset_id:', dataset_id, ')');
    }


    // 1. Create endpoint in database
    const { data: endpoint, error: endpointError } = await supabase
      .from('endpoints')
      .insert({
        user_id: user.id,
        user_email: user.email,
        path: path,
        method: method,
        project_name: project_name,
        description: description || `Dataset API for ${api_name}`,
        schema: schema,
        published: false,
        dataset_id: finalDatasetId // Vincular al dataset si existe
      })
      .select()
      .single();

    if (endpointError) {
      console.error('Error creating endpoint:', endpointError);
      return res.status(500).json({ error: 'Error creating endpoint' });
    }

    // 2. Insert all data items (batch insert)
    const items = data.map(item => ({
      endpoint_id: endpoint.id,
      user_id: user.id,
      data: item
    }));

    // Insert in chunks of 1000
    const chunkSize = 1000;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const { error: itemsError } = await supabase
        .from('endpoint_items')
        .insert(chunk);
      
      if (itemsError) {
        console.error('Error inserting items:', itemsError);
        // Continue anyway, don't fail completely
      }
    }

    // 3. Register routes
    const fullPath = `/api/${project_name}${path}`;

    // GET all items
    app.get(fullPath, async (req, res) => {
      try {
        const { data: items } = await supabase
          .from('endpoint_items')
          .select('data')
          .eq('endpoint_id', endpoint.id);
        
        res.json({
          success: true,
          data: items?.map(i => i.data) || [],
          total: items?.length || 0
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // GET by ID
    app.get(`${fullPath}/:id`, async (req, res) => {
      try {
        const { data: item } = await supabase
          .from('endpoint_items')
          .select('data')
          .eq('endpoint_id', endpoint.id)
          .eq('id', req.params.id)
          .single();
        
        if (!item) {
          return res.status(404).json({ error: 'Item not found' });
        }
        
        res.json({
          success: true,
          data: item.data
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Store in endpoints Map
    endpoints.set(endpoint.id, endpoint);

    console.log(`✓ Dataset API created: ${fullPath} with ${data.length} items`);

    res.json({
      success: true,
      endpoint: endpoint,
      itemsImported: data.length,
      datasetSaved: !!finalDatasetId,
      datasetId: finalDatasetId,
      message: 'API created successfully from dataset'
    });

  } catch (error) {
    console.error('Error in create-from-dataset:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error creating API from dataset'
    });
  }
});
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

iniciar();
// ═══════════════════════════════════════════════════════════
// 📄 API DOCUMENTATION ENDPOINT
// ═══════════════════════════════════════════════════════════
app.get('/api/docs/:project/:endpoint', async (req, res) => {
  try {
    const { project, endpoint } = req.params;
    const path = `/${endpoint}`;
    
    // Buscar el endpoint en la base de datos
    const { data, error } = await supabase
      .from('endpoints')
      .select('*')
      .eq('project_name', project)
      .eq('path', path)
      .single();
    
    if (error || !data) {
      return res.status(404).json({
        success: false,
        error: 'API not found'
      });
    }
    
    // Obtener datos de ejemplo
    let sampleData = [];
    if (data.schema) {
      const { data: items } = await supabase
        .from('endpoint_items')
        .select('data')
        .eq('endpoint_id', data.id)
        .limit(3);
      
      if (items) {
        sampleData = items.map(item => item.data);
      }
    }
    
    // Construir documentación
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fullPath = `/api/${project}${path}`;
    
    const documentation = {
      success: true,
      api: {
        name: `${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)} API`,
        project: project,
        endpoint: endpoint,
        path: fullPath,
        fullUrl: `${baseUrl}${fullPath}`,
        method: data.method,
        description: data.description,
        createdAt: data.createdAt,
        author: data.user_email
      },
      schema: data.schema || null,
      sampleData: sampleData,
      documentation: data.documentation || null,
      examples: {
        curl: `curl -X ${data.method} "${baseUrl}${fullPath}"`,
        javascript: `fetch("${baseUrl}${fullPath}")
  .then(res => res.json())
  .then(data => console.log(data));`,
        python: `import requests

response = requests.${data.method.toLowerCase()}("${baseUrl}${fullPath}")
data = response.json()
print(data)`
      },
      crud: data.schema ? {
        list: {
          method: 'GET',
          url: `${baseUrl}${fullPath}`,
          description: 'Get all items'
        },
        get: {
          method: 'GET',
          url: `${baseUrl}${fullPath}/:id`,
          description: 'Get one item by ID'
        },
        create: {
          method: 'POST',
          url: `${baseUrl}${fullPath}`,
          description: 'Create a new item',
          body: data.schema.fields.reduce((acc, field) => {
            acc[field.name] = field.type === 'number' ? 0 : 'string';
            return acc;
          }, {})
        },
        update: {
          method: 'PUT',
          url: `${baseUrl}${fullPath}/:id`,
          description: 'Update an existing item',
          body: data.schema.fields.reduce((acc, field) => {
            acc[field.name] = field.type === 'number' ? 0 : 'string';
            return acc;
          }, {})
        },
        delete: {
          method: 'DELETE',
          url: `${baseUrl}${fullPath}/:id`,
          description: 'Delete an item'
        }
      } : null
    };
    
    res.json(documentation);
    
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ═══════════════════════════════════════════════════════════
// 🤖 GENERATE API DOCUMENTATION WITH AI
// ═══════════════════════════════════════════════════════════
app.post('/api/generate-docs', async (req, res) => {
  try {
    const { prompt, apiData } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const documentation = result.response.text();
    
    res.json({
      success: true,
      documentation: documentation.replace(/```markdown/g, '').replace(/```/g, '').trim()
    });

  } catch (error) {
    console.error('Error generating docs:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error generating documentation'
    });
  }
});

// ═══════════════════════════════════════════════════════════
// 🔄 RELOAD ENDPOINTS (when edited)
// ═══════════════════════════════════════════════════════════
app.post('/api/reload-endpoints', async (req, res) => {
  try {
    console.log('🔄 Reloading endpoints...');
    await cargarEndpoints();
    res.json({ 
      success: true, 
      message: 'Endpoints reloaded',
      total: endpoints.size 
    });
  } catch (error) {
    console.error('Error reloading endpoints:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════
// 🔍 LIST AVAILABLE GEMINI MODELS (temporary debug endpoint)
// ═══════════════════════════════════════════════════════════
app.get('/api/list-models', async (req, res) => {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    
    const availableModels = data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({
        name: m.name,
        displayName: m.displayName,
        description: m.description
      }));
    
    res.json({
      success: true,
      total: availableModels.length,
      models: availableModels
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 📊 ANALYTICS MIDDLEWARE
// ═══════════════════════════════════════════════════════════
async function trackRequest(req, res, next) {
  const startTime = Date.now();
  
  // Interceptar el response para obtener status code
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    
    // Solo trackear rutas de API dinámicas
    if (req.path.startsWith('/api/') && !req.path.includes('/api/create-') && !req.path.includes('/api/marketplace') && !req.path.includes('/api/docs')) {
      // Buscar el endpoint_id
      const pathParts = req.path.split('/');
      if (pathParts.length >= 4) {
        const project = pathParts[2];
        const endpoint = '/' + pathParts[3];
        
        // Guardar analytics de forma asíncrona (no bloqueante)
        supabase
          .from('endpoints')
          .select('id')
          .eq('project_name', project)
          .eq('path', endpoint)
          .single()
          .then(({ data }) => {
            if (data) {
              supabase
                .from('api_requests')
                .insert({
                  endpoint_id: data.id,
                  method: req.method,
                  path: req.path,
                  status_code: res.statusCode,
                  response_time: responseTime,
                  ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                  user_agent: req.headers['user-agent']
                })
                .then(() => {})
                .catch(err => console.error('Analytics error:', err));
            }
          })
          .catch(() => {});
      }
    }
    
    originalSend.call(this, data);
  };
  
  next();
}

// Aplicar middleware a todas las rutas
app.use(trackRequest);

// ═══════════════════════════════════════════════════════════
// 📊 ANALYTICS ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Get analytics summary for all user's APIs
app.get('/api/analytics/summary', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user's endpoints
    const { data: userEndpoints } = await supabase
      .from('endpoints')
      .select('id, path, project_name, description')
      .eq('user_id', user.id);

    if (!userEndpoints || userEndpoints.length === 0) {
      return res.json({
        success: true,
        totalRequests: 0,
        endpoints: [],
        last24h: 0,
        last7d: 0,
        last30d: 0
      });
    }

    const endpointIds = userEndpoints.map(ep => ep.id);

    // Total requests
    const { count: totalRequests } = await supabase
      .from('api_requests')
      .select('*', { count: 'exact', head: true })
      .in('endpoint_id', endpointIds);

    // Requests last 24h
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { count: requests24h } = await supabase
      .from('api_requests')
      .select('*', { count: 'exact', head: true })
      .in('endpoint_id', endpointIds)
      .gte('created_at', last24h.toISOString());

    // Requests last 7 days
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { count: requests7d } = await supabase
      .from('api_requests')
      .select('*', { count: 'exact', head: true })
      .in('endpoint_id', endpointIds)
      .gte('created_at', last7d.toISOString());

    // Requests last 30 days
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const { count: requests30d } = await supabase
      .from('api_requests')
      .select('*', { count: 'exact', head: true })
      .in('endpoint_id', endpointIds)
      .gte('created_at', last30d.toISOString());

    // Requests per endpoint
    const endpointsWithRequests = await Promise.all(
      userEndpoints.map(async (ep) => {
        const { count } = await supabase
          .from('api_requests')
          .select('*', { count: 'exact', head: true })
          .eq('endpoint_id', ep.id);
        
        return {
          ...ep,
          requests: count || 0
        };
      })
    );

    res.json({
      success: true,
      totalRequests: totalRequests || 0,
      last24h: requests24h || 0,
      last7d: requests7d || 0,
      last30d: requests30d || 0,
      endpoints: endpointsWithRequests.sort((a, b) => b.requests - a.requests)
    });

  } catch (error) {
    console.error('Analytics summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get detailed analytics for specific endpoint
app.get('/api/analytics/endpoint/:endpointId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { endpointId } = req.params;
    const { range = '7d' } = req.query; // 24h, 7d, 30d

    // Verify ownership
    const { data: endpoint } = await supabase
      .from('endpoints')
      .select('*')
      .eq('id', endpointId)
      .eq('user_id', user.id)
      .single();

    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    // Calculate date range
    const now = new Date();
    let startDate;
    switch(range) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default: // 7d
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get requests
    const { data: requests } = await supabase
      .from('api_requests')
      .select('*')
      .eq('endpoint_id', endpointId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    // Calculate metrics
    const totalRequests = requests?.length || 0;
    const avgResponseTime = requests?.length 
      ? Math.round(requests.reduce((sum, r) => sum + (r.response_time || 0), 0) / requests.length)
      : 0;

    // Status codes distribution
    const statusCodes = {};
    requests?.forEach(r => {
      statusCodes[r.status_code] = (statusCodes[r.status_code] || 0) + 1;
    });

    // Methods distribution
    const methods = {};
    requests?.forEach(r => {
      methods[r.method] = (methods[r.method] || 0) + 1;
    });

    // Requests over time (grouped by day/hour)
    const timeGrouped = {};
    requests?.forEach(r => {
      const date = new Date(r.created_at);
      const key = range === '24h' 
        ? `${date.getHours()}:00`
        : date.toISOString().split('T')[0];
      timeGrouped[key] = (timeGrouped[key] || 0) + 1;
    });

    res.json({
      success: true,
      endpoint: {
        id: endpoint.id,
        path: endpoint.path,
        project_name: endpoint.project_name,
        description: endpoint.description
      },
      metrics: {
        totalRequests,
        avgResponseTime,
        statusCodes,
        methods,
        timeGrouped
      },
      range
    });

  } catch (error) {
    console.error('Endpoint analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});


// 🔍 DEBUG: Check if datasets table exists
app.get('/api/debug/check-tables', async (req, res) => {
  try {
    // Try to query datasets
    const { data: datasetsTest, error: datasetsError } = await supabase
      .from('datasets')
      .select('*')
      .limit(1);

    // Try to query dataset_items
    const { data: itemsTest, error: itemsError } = await supabase
      .from('dataset_items')
      .select('*')
      .limit(1);

    res.json({
      success: true,
      tables: {
        datasets: {
          exists: !datasetsError,
          error: datasetsError?.message || null,
          sample: datasetsTest
        },
        dataset_items: {
          exists: !itemsError,
          error: itemsError?.message || null,
          sample: itemsTest
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});