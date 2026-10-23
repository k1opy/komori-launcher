// Komori Skins — сервер скинов офлайн-аккаунтов на Cloudflare Workers (+ KV).
//
// Что умеет:
//  * лаунчер загружает скин:  PUT /komori/skin   (тело — PNG, заголовки X-Name, X-Variant, X-Token)
//  * лаунчер удаляет скин:    DELETE /komori/skin (X-Name, X-Token)
//  * картинка скина:          GET /skin/<ник>.png  или  /skin/<uuid>.png
//  * API для authlib-injector (Yggdrasil): игра спрашивает здесь скины игроков.
//
// Хранилище: одна KV-запись на игрока: ключ "s:<uuid>", значение — PNG, метаданные —
// { n: ник, v: classic|slim, h: хэш, t: хэш токена владельца, u: время }.
// Ключ подписи текстур создаётся сам при первом запросе и лежит в KV ("keypair").
// Секреты настраивать не нужно.

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MAX_PNG = 64 * 1024;
const JSON_H = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      return json({ error: 'internal', message: String(e && e.message || e) }, 500);
    }
  }
};

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (m === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  // ---------- Yggdrasil: метаданные для authlib-injector ----------
  if (p === '/' && m === 'GET') {
    const keys = await keyPair(env);
    return json({
      meta: { serverName: 'Komori Skins', implementationName: 'komori-skins', implementationVersion: '1',
        links: { homepage: 'https://komori.fun' } },
      skinDomains: [url.hostname],
      signaturePublickey: keys.pubPem
    });
  }

  // ---------- Yggdrasil: профиль с текстурами ----------
  let r = p.match(/^\/sessionserver\/session\/minecraft\/profile\/([0-9a-fA-F-]{32,36})$/);
  if (r && m === 'GET') {
    const uuid = dashed(r[1]);
    if (!uuid) return new Response(null, { status: 204 });
    const rec = await env.SKINS.getWithMetadata('s:' + uuid, { type: 'stream', cacheTtl: 60 });
    if (rec.value) rec.value.cancel();
    if (!rec.metadata) return new Response(null, { status: 204 });
    const signed = url.searchParams.get('unsigned') === 'false';
    return json(await profileJson(env, url, uuid, rec.metadata, signed));
  }

  // ---------- Yggdrasil: ник -> uuid ----------
  if (p === '/api/profiles/minecraft' && m === 'POST') {
    let names = [];
    try { names = await req.json(); } catch {}
    if (!Array.isArray(names)) return json({ error: 'bad request' }, 400);
    const out = [];
    for (const n of names.slice(0, 10)) {
      if (!NAME_RE.test(String(n))) continue;
      const uuid = offlineUuid(String(n));
      const rec = await env.SKINS.getWithMetadata('s:' + uuid, { type: 'stream', cacheTtl: 60 });
      if (rec.value) rec.value.cancel();
      if (rec.metadata) out.push({ id: uuid.replace(/-/g, ''), name: rec.metadata.n });
    }
    return json(out);
  }
  r = p.match(/^\/api\/users\/profiles\/minecraft\/([A-Za-z0-9_]{3,16})$/);
  if (r && m === 'GET') {
    const uuid = offlineUuid(r[1]);
    const rec = await env.SKINS.getWithMetadata('s:' + uuid, { type: 'stream', cacheTtl: 60 });
    if (rec.value) rec.value.cancel();
    if (!rec.metadata) return new Response(null, { status: 204 });
    return json({ id: uuid.replace(/-/g, ''), name: rec.metadata.n });
  }

  // ---------- Yggdrasil: вход на сервер (офлайн-серверы это не вызывают) ----------
  if (p === '/sessionserver/session/minecraft/join' && m === 'POST') return new Response(null, { status: 204 });
  if (p === '/sessionserver/session/minecraft/hasJoined') return new Response(null, { status: 204 });

  // ---------- заглушки сервисов Minecraft 1.16+ (иначе игра может выключить мультиплеер) ----------
  if (p === '/minecraftservices/player/attributes') {
    return json({
      privileges: { onlineChat: { enabled: true }, multiplayerServer: { enabled: true }, multiplayerRealms: { enabled: false }, telemetry: { enabled: false } },
      profanityFilterPreferences: { profanityFilterOn: false }
    });
  }
  if (p === '/minecraftservices/privacy/blocklist') return json({ blockedProfiles: [] });
  if (p === '/minecraftservices/publickeys') {
    const keys = await keyPair(env);
    return json({ profilePropertyKeys: [{ publicKey: keys.pubDerB64 }], playerCertificateKeys: [{ publicKey: keys.pubDerB64 }] });
  }
  if (p.startsWith('/minecraftservices/')) return json({ error: 'not supported' }, 404);

  // ---------- картинки ----------
  r = p.match(/^\/textures\/([0-9a-f-]{36})-([0-9a-f]{16})$/);
  if (r && m === 'GET') return pngResponse(env, r[1]);
  r = p.match(/^\/skin\/([A-Za-z0-9_\-]{3,36})\.png$/);
  if (r && m === 'GET') {
    const id = r[1];
    const uuid = dashed(id) || (NAME_RE.test(id) ? offlineUuid(id) : null);
    return uuid ? pngResponse(env, uuid) : new Response('not found', { status: 404 });
  }

  // ---------- загрузка из лаунчера ----------
  if (p === '/komori/skin' && (m === 'PUT' || m === 'DELETE')) return upload(req, env, url, m);

  return json({ error: 'not found' }, 404);
}

// ===== загрузка / удаление =====
async function upload(req, env, url, method) {
  // Простая защита от спама: не чаще раза в 10 секунд с одного IP.
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const rlKey = new Request('https://rl.komori/' + encodeURIComponent(ip));
  const cache = caches.default;
  if (await cache.match(rlKey)) return json({ error: 'Слишком часто, подожди 10 секунд' }, 429);
  await cache.put(rlKey, new Response('1', { headers: { 'cache-control': 'max-age=10' } }));

  const name = String(req.headers.get('x-name') || '');
  if (!NAME_RE.test(name)) return json({ error: 'Неверный ник' }, 400);
  const uuid = offlineUuid(name);
  const key = 's:' + uuid;
  const old = await env.SKINS.getWithMetadata(key, { type: 'stream' });
  if (old.value) old.value.cancel();
  const token = String(req.headers.get('x-token') || '');

  // Ник «принадлежит» тому, кто первым загрузил скин: дальше нужен его токен.
  if (old.metadata && old.metadata.t !== await sha256hex(token)) {
    return json({ error: 'Этот ник уже занят другим игроком' }, 403);
  }

  if (method === 'DELETE') {
    await env.SKINS.delete(key);
    return json({ ok: true });
  }

  const buf = new Uint8Array(await req.arrayBuffer());
  const bad = checkPng(buf);
  if (bad) return json({ error: bad }, 400);
  const variant = req.headers.get('x-variant') === 'slim' ? 'slim' : 'classic';
  const newToken = old.metadata ? token : randomHex(32);
  const meta = { n: name, v: variant, h: (await sha256hex(buf)).slice(0, 16), t: await sha256hex(newToken), u: Date.now() };
  await env.SKINS.put(key, buf, { metadata: meta });
  return json({ ok: true, uuid, hash: meta.h, token: old.metadata ? undefined : newToken,
    url: `${url.origin}/skin/${uuid}.png` });
}

function checkPng(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return 'Это не PNG-файл';
  if (b.length > MAX_PNG) return 'Файл слишком большой';
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20);
  if (w !== 64 || (h !== 64 && h !== 32)) return `Скин должен быть 64×64 или 64×32, а этот ${w}×${h}`;
  return null;
}

async function pngResponse(env, uuid) {
  const rec = await env.SKINS.getWithMetadata('s:' + uuid, { type: 'arrayBuffer', cacheTtl: 60 });
  if (!rec.value) return new Response('not found', { status: 404, headers: cors() });
  return new Response(rec.value, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=60', ...cors() } });
}

async function profileJson(env, url, uuid, meta, signed) {
  const id = uuid.replace(/-/g, '');
  const skin = { url: `${url.origin}/textures/${uuid}-${meta.h}` };
  if (meta.v === 'slim') skin.metadata = { model: 'slim' };
  const tex = { timestamp: Date.now(), profileId: id, profileName: meta.n, textures: { SKIN: skin } };
  if (signed) tex.signatureRequired = true;
  const value = b64(new TextEncoder().encode(JSON.stringify(tex)));
  const prop = { name: 'textures', value };
  if (signed) prop.signature = await sign(env, value);
  return { id, name: meta.n, properties: [prop] };
}

// ===== ключ подписи (RSA-SHA1, как у Mojang) =====
let KEYS = null;
async function keyPair(env) {
  if (KEYS) return KEYS;
  let stored = await env.SKINS.get('keypair', { type: 'json' });
  if (!stored) {
    const kp = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, true, ['sign', 'verify']);
    stored = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), spki: b64(new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey))) };
    await env.SKINS.put('keypair', JSON.stringify(stored));
  }
  const priv = await crypto.subtle.importKey('jwk', stored.priv, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' }, false, ['sign']);
  const pubPem = '-----BEGIN PUBLIC KEY-----\n' + stored.spki.match(/.{1,64}/g).join('\n') + '\n-----END PUBLIC KEY-----\n';
  KEYS = { priv, pubPem, pubDerB64: stored.spki };
  return KEYS;
}
async function sign(env, value) {
  const k = await keyPair(env);
  return b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k.priv, new TextEncoder().encode(value))));
}

// ===== утилиты =====
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...JSON_H, ...cors() } }); }
function cors() { return { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-name,x-variant,x-token', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' }; }
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function hex(u8) { return Array.from(u8, x => x.toString(16).padStart(2, '0')).join(''); }
function randomHex(n) { return hex(crypto.getRandomValues(new Uint8Array(n))); }
async function sha256hex(data) {
  const d = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', d)));
}
function dashed(s) {
  const h = String(s).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// UUID офлайн-игрока, как в Minecraft: nameUUIDFromBytes("OfflinePlayer:" + ник) — MD5, версия 3.
export function offlineUuid(name) {
  const h = md5(new TextEncoder().encode('OfflinePlayer:' + name));
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  return dashed(hex(h));
}

// MD5 (в WebCrypto его нет). Компактная реализация по RFC 1321.
export function md5(bytes) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const len = bytes.length, total = ((len + 8) >>> 6) + 1, words = new Uint32Array(total * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[total * 16 - 2] = (len * 8) >>> 0;
  words[total * 16 - 1] = Math.floor(len / 0x20000000);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < words.length; off += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      const t = d; d = c; c = b;
      const x = (a + f + K[i] + words[off + g]) >>> 0;
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16), dv = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => dv.setUint32(i * 4, v, true));
  return out;
}
