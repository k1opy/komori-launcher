# Komori Launcher

Лаунчер Minecraft для Windows от проекта [Komori](https://komori.fun). Ставит любую версию игры, сборки с модами и сам заходит на сервер Komori. Версии, Java и ресурсы игры качаются напрямую с серверов Mojang.

**[Скачать последнюю версию](https://github.com/k1opy/komori-launcher/releases/latest)** — файл `Komori-Launcher-Setup.exe`. Дальше лаунчер обновляется сам.

[Сайт](https://komori.fun) · [Discord](https://discord.gg/cQDMCZvUgp) · [Telegram](https://t.me/komorifun) · [YouTube](https://www.youtube.com/@komorifun) · [TikTok](https://www.tiktok.com/@_k1opy_)

## Что умеет

- **Играть на Komori** одной кнопкой: лаунчер сам ставит нужную версию, ядро и моды сервера и подключает к `mc.komori.fun`.
- **Любые версии Minecraft**: релизы, снапшоты, бета и альфа. Нужная Java скачивается сама (8, 17, 21).
- **Ядра**: Fabric, Quilt, Forge (в том числе старый, например 1.7.10), NeoForge.
- **Сборки**: установка с Modrinth и CurseForge, импорт `.mrpack`, zip CurseForge и сборок в формате Prism (например, GT New Horizons на Java 21).
- **Каталог модов, ресурспаков и шейдеров** Modrinth и CurseForge с фильтром по категориям, зависимости ставятся сами.
- **Аккаунты**: Microsoft, офлайн-ник, Yggdrasil (LittleSkin, Ely.by). Скин и плащ можно поменять прямо в лаунчере.
- **Аккаунт Komori**: один для лаунчера и сайта, профиль с уровнем за время в игре, графиком активности, аватаркой (базовой, своей или 3D из скина) и баннером.
- **Новости** Minecraft и Komori на главной.
- **Внешний вид**: тёмная и светлая тема, 9 цветов акцента.
- Игра не закрывается вместе с лаунчером, запуск можно отменить кнопкой «Отменить».
- Если игра вылетела, лаунчер покажет причину и даст открыть лог.

## Где что лежит

- Игра: `%APPDATA%\.komori` — версии, библиотеки, Java, папки сборок в `instances` (называются как сборки).
- Настройки, сборки и аккаунты: `%APPDATA%\Komori Launcher` (токены зашифрованы средствами Windows).
- Лог последнего запуска сборки: `instances\<сборка>\komori-launch.log`.

## Для разработчиков

Нужен Node.js 20 LTS или новее.

```
cd /d C:\Users\Killer\Desktop\KomoriLauncher
npm install
npm run dev        :: запуск с DEV-входом для тестов
npm start          :: запуск как у игроков
npm run dist:dev   :: тестовый установщик в dist\
npm run dist       :: обычный установщик в dist\
```

**Выпуск версии.** Поднять `version` в `package.json`, закоммитить в `main` и отправить `main` в ветку `release`. GitHub Actions соберёт установщик и опубликует релиз с `latest.yml` и `.blockmap` — по ним лаунчеры у игроков обновятся сами (тихо, без окна установщика).

**Настройки проекта** — `komori.config.json`:
- `msClientId` — приложение Azure для входа через Microsoft;
- `server` — адрес сервера, `serverManifestUrl` — сборка сервера для «Играть на Komori»;
- `discordUrl`, `websiteUrl`, `socialLinks` — ссылки в лаунчере (иконки: telegram, youtube, tiktok, twitch, instagram, discord, globe, link);
- `allowOffline` — разрешить офлайн-ники без входа через Microsoft.

Запросы к CurseForge идут через `komori.fun/api/cf`, ключ API хранится на сайте, а не в лаунчере.

**Структура:** `src/main/` — процесс Electron (версии, Java, ядра, запуск, аккаунты, каталоги, сборки, аккаунт Komori), `src/renderer/` — интерфейс, `site/` — сайт komori.fun (Cloudflare Worker).
