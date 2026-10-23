'use strict';
/* Пинг Minecraft-сервера напрямую (Server List Ping), без сторонних сайтов.
 * Отдаёт { online, players, max, version, ms }. Результат кэшируется на 30 секунд. */
const net = require('net');

function varint(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function packet(id, body) {
  const data = Buffer.concat([varint(id), body]);
  return Buffer.concat([varint(data.length), data]);
}
function readVarint(buf, pos) {
  let n = 0, shift = 0, b;
  do {
    if (pos >= buf.length) return null;
    b = buf[pos++]; n |= (b & 0x7f) << shift; shift += 7;
    if (shift > 35) throw new Error('bad varint');
  } while (b & 0x80);
  return [n, pos];
}

function rawPing(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), done = false;
    const finish = (r) => { if (done) return; done = true; sock.destroy(); resolve(r); };
    sock.setTimeout(timeout, () => finish({ online: false }));
    sock.on('error', () => finish({ online: false }));
    sock.on('connect', () => {
      const h = Buffer.from(host, 'utf8');
      const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(port);
      sock.write(packet(0, Buffer.concat([varint(767), varint(h.length), h, portBuf, varint(1)])));
      sock.write(packet(0, Buffer.alloc(0)));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const a = readVarint(buf, 0); if (!a) return;
        const [len, p1] = a;
        if (buf.length < p1 + len) return;
        const b = readVarint(buf, p1); const c = readVarint(buf, b[1]);
        const json = JSON.parse(buf.slice(c[1], c[1] + c[0]).toString('utf8'));
        const pl = json.players || {};
        finish({
          online: true, players: pl.online || 0, max: pl.max || 0,
          names: (pl.sample || []).map(s => s.name).filter(Boolean).slice(0, 12),
          version: (json.version && json.version.name) || '', ms: Date.now() - started
        });
      } catch { finish({ online: false }); }
    });
  });
}

let cache = null;
async function ping(host, port) {
  if (cache && cache.key === host + ':' + port && Date.now() - cache.at < 30000) return cache.value;
  const value = await rawPing(host, port || 25565);
  cache = { key: host + ':' + port, at: Date.now(), value };
  return value;
}

module.exports = { ping };
