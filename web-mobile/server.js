'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const GAME_URL = 'https://pokeidle.io/';
const MAX_ACCOUNTS = 4;
const DATA_DIR = path.resolve(process.env.PKMOBILE_DATA || path.join(__dirname, 'data'));
const TOKEN = process.env.PKMOBILE_TOKEN;
const DEV = process.env.WEB_DEV === '1' || process.argv.includes('--dev');

if (!TOKEN && !DEV) {
  console.error('PKMOBILE_TOKEN is required. Set a long random secret before exposing this server.');
  process.exit(1);
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const sessions = new Map();
const locks = new Map();
let closing = false;

function authorized(req, res, next) {
  if (DEV && !TOKEN) return next();
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(TOKEN || '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
app.use('/api', authorized);

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= MAX_ACCOUNTS ? id : null;
}
function sessionInfo(id) {
  const item = sessions.get(id);
  return { id, running: !!item, url: item?.page.url() || null, title: item?.pageTitle || null };
}
async function withLock(id, fn) {
  const previous = locks.get(id) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queued = previous.then(() => gate);
  locks.set(id, queued);
  await previous;
  try { return await fn(); }
  finally { release(); if (locks.get(id) === queued) locks.delete(id); }
}

async function startAccount(id) {
  if (sessions.has(id)) return sessionInfo(id);
  const profile = path.join(DATA_DIR, 'profiles', 'account-' + id);
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    args: ['--disable-dev-shm-usage', '--no-first-run'],
  });
  const page = context.pages()[0] || await context.newPage();
  const entry = { id, context, page, pageTitle: '' };
  sessions.set(id, entry);
  page.on('close', () => { if (sessions.get(id) === entry) sessions.delete(id); });
  page.on('domcontentloaded', async () => {
    try { entry.pageTitle = await page.title(); } catch {}
  });
  if (page.url() === 'about:blank') await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return sessionInfo(id);
}

app.get('/api/status', (_req, res) => {
  res.json({ accounts: Array.from({ length: MAX_ACCOUNTS }, (_, i) => sessionInfo(i + 1)) });
});
app.post('/api/accounts/:id/start', async (req, res, next) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_account' });
  try { res.json(await withLock(id, () => startAccount(id))); } catch (e) { next(e); }
});
app.post('/api/accounts/:id/stop', async (req, res, next) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_account' });
  try {
    await withLock(id, async () => {
      const item = sessions.get(id);
      if (item) { sessions.delete(id); await item.context.close(); }
    });
    res.json({ id, running: false });
  } catch (e) { next(e); }
});
app.get('/api/accounts/:id/screenshot', async (req, res, next) => {
  const id = validId(req.params.id);
  const item = id && sessions.get(id);
  if (!item) return res.status(404).json({ error: 'account_not_running' });
  try {
    const image = await item.page.screenshot({ type: 'jpeg', quality: 65, animations: 'disabled' });
    res.set('Cache-Control', 'no-store').type('jpeg').send(image);
  } catch (e) { next(e); }
});
app.post('/api/accounts/:id/input', async (req, res, next) => {
  const id = validId(req.params.id);
  const item = id && sessions.get(id);
  if (!item) return res.status(404).json({ error: 'account_not_running' });
  const { action, x, y, text, key, button } = req.body || {};
  try {
    if (action === 'click' || action === 'tap') {
      if (![x, y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return res.status(400).json({ error: 'coordinates_must_be_normalized' });
      const viewport = item.page.viewportSize();
      await item.page.mouse.click(Math.round(x * viewport.width), Math.round(y * viewport.height), { button: button === 'right' ? 'right' : 'left' });
    } else if (action === 'type') {
      if (typeof text !== 'string' || text.length > 2000) return res.status(400).json({ error: 'invalid_text' });
      await item.page.keyboard.insertText(text);
    } else if (action === 'key') {
      const allowed = new Set(['Enter','Escape','Tab','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ']);
      if (!allowed.has(key)) return res.status(400).json({ error: 'unsupported_key' });
      await item.page.keyboard.press(key);
    } else if (action === 'scroll') {
      const delta = Math.max(-1200, Math.min(1200, Number(req.body.delta) || 0));
      await item.page.mouse.wheel(0, delta);
    } else {
      return res.status(400).json({ error: 'unsupported_action' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.post('/api/accounts/:id/navigate', async (req, res, next) => {
  const id = validId(req.params.id);
  const item = id && sessions.get(id);
  if (!item) return res.status(404).json({ error: 'account_not_running' });
  const url = req.body?.url;
  if (url !== GAME_URL) return res.status(400).json({ error: 'navigation_restricted_to_game' });
  try { await item.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); res.json({ ok: true }); } catch (e) { next(e); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

async function shutdown() {
  if (closing) return;
  closing = true;
  await Promise.allSettled([...sessions.values()].map(s => s.context.close()));
  sessions.clear();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(PORT, HOST, () => console.log('PokeIdle Mobile server listening on ' + HOST + ':' + PORT));
