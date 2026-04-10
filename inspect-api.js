/**
 * Run: npm run inspect
 * Probes UMAI API endpoints for the restaurant slug and prints raw responses.
 * Use this to confirm the correct URL shape and response structure before deploying.
 */

import 'dotenv/config';
import fetch from 'node-fetch';

const SLUG = process.env.RESTAURANT_SLUG || 'opocot';
const BASE = process.env.UMAI_BASE_URL || 'https://umai.io';

const ENDPOINTS = [
  `/api/v1/restaurants/${SLUG}/availability`,
  `/api/v1/restaurants/${SLUG}/slots`,
  `/api/v1/restaurants/${SLUG}/bookings/availability`,
  `/api/v2/restaurants/${SLUG}/availability`,
  `/restaurants/${SLUG}/availability.json`,
];

async function probe(path) {
  const url = `${BASE}${path}`;
  console.log(`\nGET ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Opocot-Inspector/1.0',
      },
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    try {
      const json = JSON.parse(text);
      console.log('Body:', JSON.stringify(json, null, 2).slice(0, 1000));
    } catch {
      console.log('Body (non-JSON):', text.slice(0, 500));
    }
  } catch (err) {
    console.log('Error:', err.message);
  }
}

for (const ep of ENDPOINTS) {
  await probe(ep);
}
