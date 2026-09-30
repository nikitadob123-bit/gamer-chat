# ◆ GAMER CHAT

Мессенджер для геймеров — PWA на чистом HTML/CSS/JS (без сборки), русский интерфейс, портретная мобильная вёрстка, тёмная неоновая тема. Бэкенд — Supabase (Auth + Postgres + RLS + Realtime).

**Демо:** https://nikitadob123-bit.github.io/gamer-chat/ — пока в `js/config.js` пусто, работает **демо-режим** (данные в localStorage браузера, внутри есть боты; код сервера для демо: `NEON2026`).

## Возможности v1
- Регистрация/вход по **нику и паролю** (синтетический email `ник@gc-users.invalid`, почта не нужна).
- Профиль: ник, аватар (эмодзи + цвет), игры и ранги, статус «Играю в…», о себе.
- Личные и групповые чаты в реальном времени (Supabase Realtime; при недоступности WebSocket — резервный опрос раз в 4 с).
- Серверы с каналами: создать, вступить по коду-приглашению, владелец добавляет каналы.
- «Поиск тиммейтов»: объявление (игра, ранг, роль, время, слоты, заметка), фильтры по игре и рангу, кнопка «Откликнуться» открывает ЛС с готовым текстом.
- Голосование «Когда играем?» прямо в чате (2–6 вариантов, смена голоса).
- Статистика побед/поражений, винрейт, серия.
- Офлайн-оболочка (service worker), manifest, установка на экран «Домой».
- Звонков и голосовых комнат нет (вне рамок v1).

## Подключение Supabase (5 минут)
1. Создайте проект на supabase.com.
2. **Authentication → Providers → Email**: отключите **Confirm email** (иначе вход по нику не сработает).
3. **SQL Editor** → вставьте весь `supabase/schema.sql` → Run.
4. **Project Settings → API**: скопируйте *Project URL* и *anon public key* в `js/config.js`:
   ```js
   window.GC_CONFIG = { SUPABASE_URL: 'https://xxxx.supabase.co', SUPABASE_ANON_KEY: 'eyJ…', EMAIL_DOMAIN: 'gc-users.invalid' };
   ```
   Используется **только anon key** (он публичный); `service_role` в клиент не кладите никогда.
5. Закоммитьте и запушьте — GitHub Pages обновится. `?demo=1` в URL принудительно включает демо-режим.

## Безопасность
- RLS включён на всех таблицах; `anon` не имеет прав ни на одну таблицу и функцию (кроме `nick_available`).
- ЛС видят только два участника; группы — участники; каналы — члены сервера. Сообщение нельзя отправить от чужого имени (`sender_id` выставляется сервером из `auth.uid()`, колонка недоступна на запись).
- Создание чатов/серверов/опросов — через `SECURITY DEFINER` RPC с проверками; прямой вставки в `chats`, `chat_members`, `server_members` нет.
- Лимиты длины — `CHECK` в БД + `maxlength`/обрезка в клиенте. Не более 5 открытых объявлений на игрока, 10 серверов, 20 каналов.
- XSS: UI строится через DOM API и `textContent` (нет `innerHTML` с данными); CSP `script-src 'self'`; цвета валидируются.
- Внешних ресурсов нет, кроме соединения с `*.supabase.co`; `supabase-js` вендорен в `vendor/`.

## Тесты
```bash
tests/run_all.sh          # всё сразу
node tests/logic.test.js  # логика (node)
node tests/e2e_demo.js    # headless Chrome 390×844, демо-режим
tests/run_rls.sh          # schema.sql + RLS на локальном Postgres
tests/run_e2e_remote.sh   # клиент remote.js ↔ локальный стенд (Postgres+PostgREST+мок Auth)
```
Для последних двух нужны `postgresql`, `sudo`, бинарник PostgREST в `/workspace/gc-tools/postgrest`, `puppeteer-core` и Chrome. **Реальный Supabase (Auth, Realtime/WebSocket) этими тестами не проверяется** — стенд эмулирует только REST и Auth. Скриншоты — `docs/screens/`.

## Структура
`index.html`, `sw.js`, `manifest.webmanifest`, `css/style.css`, `js/{util,demo,remote,app,config}.js`, `vendor/supabase.js` (supabase-js v2.117.2, MIT), `supabase/schema.sql`.
