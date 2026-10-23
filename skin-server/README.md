# Komori Skins — сервер скинов офлайн-аккаунтов

Cloudflare Worker + KV. Бесплатного тарифа хватает с запасом (100 000 запросов и 1 000 загрузок скинов в день).

## Установка через панель Cloudflare
1. dash.cloudflare.com → **Storage & Databases → KV** → Create namespace `komori-skins`.
2. **Workers & Pages → Create → Worker**, имя `komori-skins` → Deploy → **Edit code** → вставить `worker.js` целиком → Deploy.
3. Worker → **Settings → Bindings → Add → KV namespace**: Variable name `SKINS`, namespace `komori-skins` → Deploy.
4. Адрес вида `https://komori-skins.<имя>.workers.dev` вписать в `komori.config.json` → `skinServerUrl`.

Проверка: открыть адрес в браузере — должен прийти JSON с `"serverName": "Komori Skins"`.

## Как это работает
- Лаунчер загружает PNG: `PUT /komori/skin`. Первый, кто загрузил скин на ник, получает секретный токен — дальше менять скин этого ника может только он. Сбросить «владение» ником: удалить ключ `s:<uuid>` в KV.
- При запуске игры с офлайн-аккаунтом лаунчер подключает authlib-injector с этим адресом. Игра запрашивает скины игроков здесь — их видят все, кто играет через Komori Launcher.
- Ключ подписи текстур создаётся сам при первом запросе (ключ `keypair` в KV). Не удаляй его, иначе скины перестанут проходить проверку подписи до перезапуска игры.
