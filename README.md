# 🌯 Kebapi

AI-powered REST API endpoint generator. Create fully functional REST APIs using natural language.

[![npm version](https://img.shields.io/npm/v/kebapi.svg)](https://www.npmjs.com/package/kebapi)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- ✨ **AI-Powered**: Generate endpoints using natural language with Google Gemini
- ☁️ **Cloud Database**: Persistent storage with Supabase
- 🌐 **Web Interface**: Professional web UI at [kebapi.up.railway.app](https://kebapi.up.railway.app)
- 💻 **CLI Tool**: Interactive command-line interface
- 🚀 **Instant Deploy**: Endpoints are instantly available online
- 🔄 **Real-time Sync**: CLI and web interface share the same database

## Installation
```bash
npm install -g kebapi
```

## Usage

Simply run:
```bash
kebapi
```

Then follow the interactive prompts to:
- Generate new endpoints
- List all endpoints
- Open the web interface

## Example
```bash
$ kebapi

# Choose "Generate new endpoint"
# Describe: "endpoint of restaurants with name, cuisine, address, and rating"
# AI generates: GET /api/restaurants

# Your endpoint is now live at:
# https://kebapi.up.railway.app/api/restaurants
```

## Web Interface

Access the full web interface at: **https://kebapi.up.railway.app**

## Tech Stack

- **AI**: Google Gemini 2.5 Flash
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Railway
- **Frontend**: Vanilla JS + Font Awesome
- **CLI**: Node.js + Inquirer

## License

MIT

## Author

Created by [@Stratos](https://github.com/Stratos)

## Links

- [GitHub Repository](https://github.com/Stratos/kebapi)
- [Web Interface](https://kebapi.up.railway.app)
- [Report Issues](https://github.com/Stratos/kebapi/issues)
