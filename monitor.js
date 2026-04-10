import 'dotenv/config';
import fetch from 'node-fetch';

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  RESTAURANT_SLUG = 'rembayung',
  POLL_INTERVAL_MS = '30000',
  UMAI_BASE_URL = 'https://umai.io',
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID');
  process.exit(1);
}

const POLL_MS = parseInt(POLL_INTERVAL_MS, 10);
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Track seen slots to avoid duplicate alerts
const seenSlots = new Set();

async function fetchAvailableSlots() {
  // UMAI booking API — returns available dates/times for a restaurant slug
  const url = `${UMAI_BASE_URL}/api/v1/restaurants/${RESTAURANT_SLUG}/availability`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'DapatMeja-Bot/1.0',
    },
  });

  if (!res.ok) {
    throw new Error(`UMAI API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

function parseSlots(data) {
  // Adapt this to match actual UMAI response shape (run inspect-api.js first)
  const slots = [];

  if (Array.isArray(data)) {
    for (const entry of data) {
      const date = entry.date || entry.slot_date || entry.datetime;
      const time = entry.time || entry.slot_time || '';
      const pax = entry.pax || entry.capacity || entry.available_pax || '';
      if (date) slots.push({ date, time, pax });
    }
  } else if (data?.slots) {
    return parseSlots(data.slots);
  } else if (data?.availability) {
    return parseSlots(data.availability);
  }

  return slots;
}

function slotKey(slot) {
  return `${slot.date}|${slot.time}|${slot.pax}`;
}

async function sendTelegram(message) {
  const res = await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHANNEL_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}

function formatAlert(newSlots) {
  const lines = newSlots.map(s => {
    const time = s.time ? ` @ ${s.time}` : '';
    const pax = s.pax ? ` (${s.pax} pax)` : '';
    return `📅 <b>${s.date}</b>${time}${pax}`;
  });

  return [
    '🔔 <b>Dapat Meja!</b> Slot baru terbuka di Rembayung:\n',
    ...lines,
    '',
    '👉 Book sekarang: https://umai.io/restaurants/rembayung',
  ].join('\n');
}

async function poll() {
  try {
    const data = await fetchAvailableSlots();
    const slots = parseSlots(data);

    const newSlots = slots.filter(s => !seenSlots.has(slotKey(s)));

    if (newSlots.length > 0) {
      console.log(`[${new Date().toISOString()}] ${newSlots.length} new slot(s) found`);
      await sendTelegram(formatAlert(newSlots));
      newSlots.forEach(s => seenSlots.add(slotKey(s)));
    } else {
      console.log(`[${new Date().toISOString()}] No new slots`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Poll error:`, err.message);
  }
}

console.log(`Dapat Meja bot started. Polling every ${POLL_MS / 1000}s for "${RESTAURANT_SLUG}"...`);
poll(); // immediate first check
setInterval(poll, POLL_MS);
