import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// Vercel's deployed filesystem is read-only. /tmp is writable but temporary.
const DATA = path.join(os.tmpdir(), 'cam-geo-data');
const PUBLIC = path.resolve('public');
fs.mkdirSync(DATA, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC));

const upload = multer({
  storage: multer.diskStorage({
    destination: DATA,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send('ADMIN_PASSWORD is not configured.');
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { decoded = ''; }
  const separator = decoded.indexOf(':');
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';
  if (password !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Invalid credentials');
  }
  next();
}

function readRecords() {
  const file = path.join(DATA, 'records.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).reverse().map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

app.post('/api/collect', upload.single('image'), (req, res) => {
  try {
    if (req.body.consent !== 'true') return res.status(400).json({ ok: false, error: 'Consent required' });
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      receivedAt: new Date().toISOString(),
      consent: true,
      visitor: JSON.parse(req.body.visitor || '{}'),
      location: JSON.parse(req.body.location || 'null'),
      imageFile: req.file ? req.file.filename : null
    };
    fs.appendFileSync(path.join(DATA, 'records.ndjson'), JSON.stringify(record) + '\n');
    res.json({ ok: true, id: record.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Could not save record' });
  }
});

app.get('/admin', requireAdmin, (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'admin.html'));
});

app.get('/api/admin/records', requireAdmin, (_req, res) => {
  res.json({ ok: true, records: readRecords() });
});

app.get('/admin/images/:name', requireAdmin, (req, res) => {
  const safeName = path.basename(req.params.name);
  const file = path.join(DATA, safeName);
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.sendFile(file);
});

// Vercel handles the server process. Listen only when running locally.
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Listening on ${PORT}`));
}

export default app;

