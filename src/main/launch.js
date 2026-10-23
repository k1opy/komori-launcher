'use strict';
// Сборка аргументов и запуск игры.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { rulesAllow } = require('./versions');

const LAUNCHER_NAME = 'komori-launcher';

function substitute(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

function collect(list, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(a); continue; }
    if (!rulesAllow(a.rules, features)) continue;
    if (Array.isArray(a.value)) out.push(...a.value); else out.push(a.value);
  }
  return out;
}

function usesFeature(list, name) {
  return (list || []).some(a => typeof a === 'object' && (a.rules || []).some(r => r.features && name in r.features));
}

// ctx: { root, install, account, gameDir, ramMb, logConfigPath, launcherVersion, join: {host, port} | null, width, height }
function buildArgs(ctx) {
  const { install, account } = ctx;
  const v = install.version;
  const classpath = [...install.classpath, install.jarPath].join(';');
  const uuid = (account.uuid || '').replace(/-/g, '');
  const token = account.accessToken || '0';

  const vars = {
    auth_player_name: account.name,
    version_name: v.id,
    game_directory: ctx.gameDir,
    assets_root: install.assets.assetsRoot,
    game_assets: install.assets.gameAssets,
    assets_index_name: install.assets.index,
    auth_uuid: uuid,
    auth_access_token: token,
    auth_session: `token:${token}:${uuid}`,
    auth_xuid: account.xuid || '0',
    clientid: account.clientId || '0',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: 'Komori',
    natives_directory: install.nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: ctx.launcherVersion || '0.1.0',
    classpath,
    classpath_separator: ';',
    library_directory: path.join(ctx.root, 'libraries'),
    resolution_width: ctx.width || 925,
    resolution_height: ctx.height || 530,
    quickPlayMultiplayer: ctx.join ? `${ctx.join.host}:${ctx.join.port}` : '',
    quickPlayPath: path.join(ctx.gameDir, 'quickPlay', 'log.json')
  };

  const gameList = v.arguments && v.arguments.game;
  const joinViaQuickPlay = !!(ctx.join && usesFeature(gameList, 'is_quick_play_multiplayer'));
  const features = { is_demo_user: false, has_custom_resolution: false, is_quick_play_multiplayer: joinViaQuickPlay };

  // JVM
  let jvm = [];
  if (v.arguments && v.arguments.jvm) {
    jvm = collect(v.arguments.jvm, features);
  } else {
    jvm = [
      '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump',
      '-Djava.library.path=${natives_directory}',
      '-cp', '${classpath}'
    ];
  }
  const mem = [`-Xmx${ctx.ramMb}M`, `-Xms${Math.min(ctx.ramMb, 1024)}M`];
  jvm = [...mem, ...jvm.map(a => substitute(a, vars))];
  // Подстраховка: некоторые json не передают путь к нативным явно.
  if (!jvm.some(a => a.startsWith('-Djava.library.path='))) jvm.unshift(`-Djava.library.path=${install.nativesDir}`);
  if (v.logging && v.logging.client && ctx.logConfigPath) jvm.push(substitute(v.logging.client.argument, { path: ctx.logConfigPath }));
  // Доп. аргументы JVM от лаунчера (например, -javaagent authlib-injector для скинов офлайн-аккаунтов)
  if (Array.isArray(ctx.extraJvm)) jvm.push(...ctx.extraJvm);

  // Игра
  let game = gameList ? collect(gameList, features) : String(v.minecraftArguments || '').split(' ').filter(Boolean);
  game = game.map(a => substitute(a, vars));
  if (ctx.join && !joinViaQuickPlay) game.push('--server', ctx.join.host, '--port', String(ctx.join.port));

  return { jvm, mainClass: v.mainClass, game };
}

function launch(javaw, args, gameDir, onLog, onExit) {
  fs.mkdirSync(gameDir, { recursive: true });
  const child = spawn(javaw, [...args.jvm, args.mainClass, ...args.game], { cwd: gameDir, windowsHide: false, detached: false });
  const logStream = fs.createWriteStream(path.join(gameDir, 'komori-launch.log'), { flags: 'w' });
  const handle = buf => { const s = buf.toString(); logStream.write(s); onLog && onLog(s); };
  child.stdout.on('data', handle);
  child.stderr.on('data', handle);
  child.on('error', err => { logStream.end(); onExit && onExit(-1, err.message); });
  child.on('exit', code => { logStream.end(); onExit && onExit(code); });
  return child;
}

module.exports = { buildArgs, launch, substitute };
