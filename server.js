// Calorie tracker — zero-dependency Node server.
// Serves the static frontend from ./public and a small JSON API backed by a file.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 4100;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];
const DEFAULT_GOALS = { calories: 2200, protein: 150, carbs: 250, fat: 70 };

// ---------- storage ----------
function load() {
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { entries: db.entries || [], goals: { ...DEFAULT_GOALS, ...db.goals } };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Failed to read data file:', e.message);
    return { entries: [], goals: { ...DEFAULT_GOALS } };
  }
}

let db = load();

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE); // atomic replace
}

// ---------- helpers ----------
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0;
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function validateEntry(b) {
  const name = String(b.name || '').trim().slice(0, 100);
  if (!name) return { error: 'Name is required' };
  if (!isDate(b.date)) return { error: 'Invalid date' };
  const meal = MEALS.includes(b.meal) ? b.meal : 'snacks';
  return {
    entry: {
      name, meal, date: b.date,
      calories: num(b.calories), protein: num(b.protein), carbs: num(b.carbs), fat: num(b.fat),
    },
  };
}

// Distinct recently used foods, newest first — powers the "quick add" autocomplete.
function recentFoods(limit = 50) {
  const seen = new Map();
  for (let i = db.entries.length - 1; i >= 0 && seen.size < limit; i--) {
    const e = db.entries[i];
    const key = e.name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { name: e.name, calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat });
    }
  }
  return [...seen.values()];
}

// ---------- API ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (parts[1] === 'entries' && parts.length === 2) {
    if (req.method === 'GET') {
      const date = url.searchParams.get('date');
      if (!isDate(date)) return send(res, 400, { error: 'Invalid date' });
      return send(res, 200, db.entries.filter((e) => e.date === date));
    }
    if (req.method === 'POST') {
      const { entry, error } = validateEntry(await readBody(req));
      if (error) return send(res, 400, { error });
      entry.id = crypto.randomUUID();
      entry.createdAt = new Date().toISOString();
      db.entries.push(entry);
      save();
      return send(res, 201, entry);
    }
  }

  if (parts[1] === 'entries' && parts.length === 3) {
    const idx = db.entries.findIndex((e) => e.id === parts[2]);
    if (idx === -1) return send(res, 404, { error: 'Not found' });
    if (req.method === 'PUT') {
      const { entry, error } = validateEntry(await readBody(req));
      if (error) return send(res, 400, { error });
      db.entries[idx] = { ...db.entries[idx], ...entry };
      save();
      return send(res, 200, db.entries[idx]);
    }
    if (req.method === 'DELETE') {
      db.entries.splice(idx, 1);
      save();
      return send(res, 204);
    }
  }

  if (parts[1] === 'goals' && parts.length === 2) {
    if (req.method === 'GET') return send(res, 200, db.goals);
    if (req.method === 'PUT') {
      const b = await readBody(req);
      for (const k of Object.keys(DEFAULT_GOALS)) if (k in b) db.goals[k] = num(b[k]);
      save();
      return send(res, 200, db.goals);
    }
  }

  if (parts[1] === 'foods' && req.method === 'GET') return send(res, 200, recentFoods());

  send(res, 404, { error: 'Not found' });
}

// ---------- static ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      serveStatic(res, decodeURIComponent(url.pathname));
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  })
  .listen(PORT, HOST, () => console.log(`Calorie tracker listening on http://${HOST}:${PORT}`));
