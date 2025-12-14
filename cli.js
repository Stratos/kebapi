#!/usr/bin/env node

/**
 * Kebapi CLI
 * AI-powered REST API endpoint generator
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const inquirer = require('inquirer');
const chalk = require('chalk');
const Table = require('cli-table3');
const boxen = require('boxen');
const gradient = require('gradient-string');
const figlet = require('figlet');
const ora = require('ora');
const supabase = require('./supabase-config');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyA9Nc7b8L8-B1sTlJR4jPQLZkP5oMdPoLY';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const endpoints = new Map();

// Funciones de Supabase
async function cargarEndpoints() {
  try {
    const { data, error } = await supabase
      .from('endpoints')
      .select('*')
      .order('createdAt', { ascending: false });
    
    if (error) throw error;
    
    data.forEach(ep => {
      endpoints.set(ep.id, ep);
    });
    
    return endpoints.size;
  } catch (error) {
    console.error(chalk.red('Error loading endpoints:', error.message));
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
    console.error(chalk.red('Error saving endpoint:', error.message));
    return null;
  }
}

function mostrarBanner() {
  console.clear();
  const banner = figlet.textSync('KEBAPI', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted'
  });
  console.log(gradient.pastel.multiline(banner));
  console.log(chalk.cyan.bold('                  🌯 AI-Powered API Generator\n'));
  console.log(chalk.gray('                  Database: ') + chalk.magenta(`Supabase ☁️\n`));
}

async function generarEndpoint() {
  console.clear();
  mostrarBanner();
  
  const { prompt } = await inquirer.prompt([
    {
      type: 'input',
      name: 'prompt',
      message: chalk.yellow('🌯 Describe the endpoint you want to create:'),
      validate: (input) => input.length >= 10 || chalk.red('Minimum 10 characters')
    }
  ]);

  const spinner = ora({
    text: chalk.cyan('Generating endpoint with AI...'),
    color: 'cyan',
    spinner: 'dots'
  }).start();
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const aiPrompt = 'Create a REST API endpoint in JSON for: ' + prompt + '. Format: {"path": "/name", "method": "GET", "description": "...", "responseData": {"success": true, "data": [3 objects with real data], "total": 3}}. Only JSON, no markdown.';

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
    
    const saved = await guardarEndpoint(endpointCompleto);
    
    if (saved) {
      endpoints.set(saved.id, saved);
      
      spinner.succeed(chalk.green.bold('✅ Endpoint created and saved to Supabase!'));
      
      console.log('\n' + boxen(
        chalk.bold.white('🏷️  Method: ') + chalk.cyan(saved.method) + '\n' +
        chalk.bold.white('📍 Path: ') + chalk.yellow('/api' + saved.path) + '\n' +
        chalk.bold.white('📝 Description: ') + chalk.gray(saved.description) + '\n' +
        chalk.bold.white('🌍 URL: ') + chalk.green.underline(`https://kebapi.up.railway.app/api${saved.path}`) + '\n' +
        chalk.bold.white('💾 Status: ') + chalk.magenta('☁️  Saved to Supabase'),
        {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor: 'green'
        }
      ));
    } else {
      spinner.fail(chalk.red.bold('❌ Error saving to Supabase'));
    }
    
  } catch (error) {
    spinner.fail(chalk.red.bold('❌ Error generating endpoint'));
    console.log(chalk.red('\n' + error.message));
  }
}

function listarEndpoints() {
  console.clear();
  mostrarBanner();
  
  if (endpoints.size === 0) {
    console.log(boxen(
      chalk.yellow.bold('🍽️  No endpoints yet\n\n') +
      chalk.gray('Generate your first endpoint from the main menu'),
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
      chalk.cyan.bold('Method'),
      chalk.cyan.bold('Path'),
      chalk.cyan.bold('Description')
    ],
    colWidths: [5, 10, 35, 50],
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
    
    table.push([
      chalk.white(index++),
      metodoBadge,
      chalk.yellow('/api' + ep.path),
      chalk.gray(ep.description.substring(0, 45) + '...')
    ]);
  });
  
  console.log(table.toString());
  console.log('\n' + chalk.cyan.bold(`📊 Total endpoints: ${endpoints.size}`));
  console.log(chalk.magenta(`☁️  Database: Supabase`));
  console.log(chalk.gray(`🌐 Web: https://kebapi.up.railway.app\n`));
}

async function menuPrincipal() {
  while (true) {
    console.clear();
    mostrarBanner();
    
    const { opcion } = await inquirer.prompt([
      {
        type: 'list',
        name: 'opcion',
        message: chalk.bold.white('What would you like to do?'),
        choices: [
          { name: chalk.green('🌯 Generate new endpoint'), value: 'generar' },
          { name: chalk.cyan('📋 List all endpoints'), value: 'listar' },
          { name: chalk.blue('🌐 Open web interface'), value: 'web' },
          new inquirer.Separator(),
          { name: chalk.gray('🚪 Exit'), value: 'salir' }
        ]
      }
    ]);
    
    switch (opcion) {
      case 'generar':
        await generarEndpoint();
        await inquirer.prompt([{ type: 'input', name: 'continuar', message: chalk.gray('\nPress Enter to continue...') }]);
        break;
        
      case 'listar':
        listarEndpoints();
        await inquirer.prompt([{ type: 'input', name: 'continuar', message: chalk.gray('\nPress Enter to continue...') }]);
        break;
        
      case 'web':
        console.log('\n' + chalk.cyan('Opening web interface...'));
        console.log(chalk.green.underline('https://kebapi.up.railway.app') + '\n');
        require('child_process').exec('open https://kebapi.up.railway.app');
        await inquirer.prompt([{ type: 'input', name: 'continuar', message: chalk.gray('Press Enter to continue...') }]);
        break;
        
      case 'salir':
        console.clear();
        console.log(gradient.rainbow('\n  Thanks for using KEBAPI! 🌯\n'));
        console.log(chalk.gray('  See you soon...\n'));
        process.exit(0);
    }
  }
}

async function iniciar() {
  const spinner = ora({
    text: chalk.cyan('Loading Kebapi...'),
    color: 'cyan'
  }).start();
  
  const cargados = await cargarEndpoints();
  
  spinner.succeed(chalk.green('Ready!'));
  
  if (cargados > 0) {
    console.log(chalk.magenta(`☁️  ${cargados} endpoints loaded from Supabase\n`));
  }
  
  setTimeout(() => {
    menuPrincipal();
  }, 500);
}

iniciar();
