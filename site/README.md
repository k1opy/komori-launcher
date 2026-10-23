# Komori — сайт

Cloudflare Worker: страницы (Главная, Правила, Вики, Карта, Профиль), вход через Discord с проверкой ботом, профили в KV.

- Исходники: `site/src` (страницы `pages/*.html` — разметка макетов, движок `komori-dc.js`, сервер `worker.js`).
- Сборка в один файл: `node site/build.mjs` → `site/dist/worker.js` (его вставляют в редактор Worker'а).

## Настройка Worker'а `komori-site`
- KV-привязка `SITE` → пространство `komori-site`.
- Секреты (Settings → Variables and Secrets, тип Secret): `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`.
- Переменная (необязательно) `ROLE_BADGES`: `{"<id роли>":{"label":"VIP","color":"#FFC857"},"<id>":{"label":"Админ","color":"#FF7EDB"}}`.
- В Discord Developer Portal → OAuth2 → Redirects: `https://<адрес сайта>/auth/callback`.
- Бот должен быть на сервере Komori (права не нужны).
