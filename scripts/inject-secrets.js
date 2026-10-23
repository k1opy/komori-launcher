// Подставляет секреты GitHub (ключ CurseForge, вебхук вылетов) в komori.config.json перед сборкой.
// В репозитории эти поля пустые — так ключи не попадают в открытый код.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'komori.config.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const set = (key, env) => { if (process.env[env]) { cfg[key] = process.env[env]; console.log(`${key}: задан из секрета ${env}`); } else console.log(`${key}: секрет ${env} не задан, оставляю как есть`); };
set('curseforgeApiKey', 'CURSEFORGE_API_KEY');
set('crashWebhookUrl', 'CRASH_WEBHOOK_URL');
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
