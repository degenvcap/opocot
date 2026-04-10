import 'dotenv/config';
import fetch from 'node-fetch';
import { solveChallenge } from 'altcha-lib';

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  VENUE_API_KEY = '3de1f391-9f59-4b07-ab7e-200ead279711',
  PARTY_SIZES = '1,2,3,4,5,6',
  POLL_INTERVAL_MS = '30000',
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID');
  process.exit(1);
}

const POLL_MS = parseInt(POLL_INTERVAL_MS, 10);
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const API = 'https://letsumai.com/widget/api/v2';
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'origin': 'https://reservation.umai.io',
  'referer': 'https://reservation.umai.io/',
  'accept': 'application/json',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  'sec-fetch-dest': 'empty',
};

// Token cache — refresh before 15 min expiry
let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  // Step 1: Get challenge
  const challengeRes = await fetch(`${API}/altcha/challenge`, {
    headers: { ...BROWSER_HEADERS, 'venue-api-key': VENUE_API_KEY },
  });
  if (!challengeRes.ok) throw new Error(`Challenge fetch failed: ${challengeRes.status}`);
  const challenge = await challengeRes.json();

  // Step 2: Solve proof-of-work
  const { promise } = solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, 300000);
  const solved = await promise;
  if (!solved) throw new Error('Failed to solve ALTCHA challenge');

  // Build base64 payload expected by verify endpoint
  const payload = Buffer.from(JSON.stringify({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    number: solved.number,
    salt: challenge.salt,
    signature: challenge.signature,
  })).toString('base64');

  // Step 3: Verify and get JWT
  const verifyRes = await fetch(`${API}/altcha/verify`, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, 'venue-api-key': VENUE_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ solution: payload }),
  });
  if (!verifyRes.ok) throw new Error(`Token verify failed: ${verifyRes.status}`);
  const { token } = await verifyRes.json();

  cachedToken = token;
  tokenExpiresAt = Date.now() + 14 * 60 * 1000; // refresh at 14 min (expires at 15)
  console.log(`[${new Date().toISOString()}] Fresh ALTCHA token obtained`);
  return token;
}

function getMonthRange() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const start = `01-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const end = `${lastDay}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  return { start, end };
}

async function fetchCalendar(partySize, token) {
  const { start, end } = getMonthRange();
  const url = `${API}/slots/calendar?party_size=${partySize}&start_date=${start}&end_date=${end}`;
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, 'venue-api-key': VENUE_API_KEY, 'x-altcha-token': token },
  });
  if (!res.ok) throw new Error(`Calendar API ${res.status} for pax ${partySize}`);
  return res.json();
}

async function fetchSlots(date, partySize, token) {
  const url = `${API}/slots?party_size=${partySize}&date=${date}`;
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, 'venue-api-key': VENUE_API_KEY, 'x-altcha-token': token },
  });
  if (!res.ok) return [];
  const data = await res.json();

  // Response is array of availability periods, each with a `slots` object keyed by time
  // e.g. [{ reservation_availability: { name: "Dine In First Session" }, slots: { "11:00": {...} } }]
  const times = [];
  for (const period of (Array.isArray(data) ? data : [])) {
    const slots = period.slots;
    if (slots && typeof slots === 'object' && !Array.isArray(slots)) {
      for (const [time, info] of Object.entries(slots)) {
        // info can be an object with availability details, or just truthy
        const available = info?.available !== false;
        if (available) times.push({ time, session: period.reservation_availability?.name });
      }
    }
  }
  return times;
}

function parseBookableDates(data, partySize) {
  const entries = Array.isArray(data)
    ? data
    : Object.entries(data).map(([date, info]) => ({ date, ...info }));

  return entries
    .filter(e =>
      e.is_open === true &&
      e.within_min_advance === true &&
      e.within_max_advance === true &&
      e.no_availability === false
    )
    .map(e => ({ date: e.date, pax: partySize }));
}

// Track alerted slots: "date|pax|time"
const alerted = new Set();

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
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

function formatAlert(alerts) {
  const lines = alerts.map(a => {
    const slotLines = a.slots.map(s => {
      const session = s.session ? ` (${s.session.trim()})` : '';
      return `    ⏰ ${s.time}${session}`;
    }).join('\n');
    return `📅 <b>${a.date}</b> — ${a.pax} pax\n${slotLines}`;
  });
  return [
    '🔔 <b>Opocot! Ada slot baru terbuka!</b>\n',
    ...lines,
    '',
    '👉 <a href="https://reservation.umai.io/en/widget/rembayung">Book sekarang</a>',
  ].join('\n');
}

async function poll() {
  try {
    const token = await getToken();
    const partySizes = PARTY_SIZES.split(',').map(n => n.trim());
    const newAlerts = [];

    for (const pax of partySizes) {
      const calendar = await fetchCalendar(pax, token);
      const bookable = parseBookableDates(calendar, pax);

      for (const { date, pax: p } of bookable) {
        const slots = await fetchSlots(date, p, token);
        const newSlotObjs = slots.filter(s => !alerted.has(`${date}|${p}|${s.time}`));
        if (newSlotObjs.length > 0) {
          newAlerts.push({ date, pax: p, slots: newSlotObjs });
          newSlotObjs.forEach(s => alerted.add(`${date}|${p}|${s.time}`));
        }
      }
    }

    if (newAlerts.length > 0) {
      console.log(`[${new Date().toISOString()}] ${newAlerts.length} new slot(s)!`);
      await sendTelegram(formatAlert(newAlerts));
    } else {
      console.log(`[${new Date().toISOString()}] No new slots`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Poll error:`, err.message);
  }
}

console.log(`Opocot bot started. Polling every ${POLL_MS / 1000}s...`);
poll();
setInterval(poll, POLL_MS);
