# Dapat Meja 🍽️

Free Telegram alert bot — monitors Rembayung's UMAI booking page and blasts 
alerts when new reservation slots open.

## Setup

```bash
npm install
cp .env.example .env
# Fill in .env with your values
```

## Step 1 — Create Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. `/newbot` → name it `Dapat Meja`, username `DapatMejaBot`
3. Copy the token → `TELEGRAM_BOT_TOKEN` in `.env`

## Step 2 — Create channel

1. Create Telegram channel `@DapatMeja` (public)
2. Add your bot as **Admin** (needs "Post Messages" permission)
3. Set `TELEGRAM_CHANNEL_ID=@DapatMeja` in `.env`

## Step 3 — Confirm UMAI endpoints

```bash
npm run inspect
```

Look for a `200` response with slot data. Update `parseSlots()` in `monitor.js`
to match the actual response shape.

## Step 4 — Run locally

```bash
npm start
```

## Deploy to Railway

1. Push to GitHub
2. New project → Deploy from GitHub repo
3. Set env vars (Settings → Variables): same as `.env`
4. Railway auto-runs `npm start` — bot is live 24/7

## Env vars

| Key | Example | Notes |
|-----|---------|-------|
| `TELEGRAM_BOT_TOKEN` | `123:ABC...` | From @BotFather |
| `TELEGRAM_CHANNEL_ID` | `@DapatMeja` | Channel username or numeric ID |
| `RESTAURANT_SLUG` | `rembayung` | UMAI restaurant slug |
| `UMAI_BASE_URL` | `https://umai.io` | Base URL (don't change) |
| `POLL_INTERVAL_MS` | `30000` | 30s default |
