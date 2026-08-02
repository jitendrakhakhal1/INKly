const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const ROOT = __dirname;
const STORAGE_DIR = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : ROOT;
const DATA_FILE = path.join(STORAGE_DIR, 'data.json');
const RAZORPAY_CONFIG_FILE = path.join(ROOT, 'razorpay-config.json');
const MAX_BODY_SIZE = 20_000_000;
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const RENDERS_DIR = path.join(STORAGE_DIR, 'tmp', 'pdf-pages');
const PDF_RENDER_BATCH_SIZE = 4;
const POPPLER_BIN_DIR = path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'poppler', 'Library', 'bin');
const PDFINFO_BIN = fs.existsSync(path.join(POPPLER_BIN_DIR, 'pdfinfo.exe')) ? path.join(POPPLER_BIN_DIR, 'pdfinfo.exe') : 'pdfinfo';
const PDFTOPPM_BIN = fs.existsSync(path.join(POPPLER_BIN_DIR, 'pdftoppm.exe')) ? path.join(POPPLER_BIN_DIR, 'pdftoppm.exe') : 'pdftoppm';
const razorpayConfig = readRazorpayConfig();
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || razorpayConfig.keyId || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || razorpayConfig.keySecret || '';
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOTE_WARM_PAGE_COUNT = 8;
const NOTE_WARM_LIMIT = 12;
const COURSE_SUBJECTS = {
  MBBS: {
    'Year 1': ['Anatomy', 'Physiology', 'Biochemistry'],
    'Year 2': ['Pathology', 'Pharmacology', 'Microbiology', 'Forensic Medicine'],
    'Year 3': ['Community Medicine', 'Ophthalmology', 'ENT'],
    'Year 4': ['General Medicine', 'General Surgery', 'Paediatrics', 'Obstetrics & Gynaecology']
  },
  BDS: {
    'Year 1': ['General Anatomy', 'General Physiology', 'Biochemistry', 'Dental Anatomy'],
    'Year 2': ['General Pathology', 'General Pharmacology', 'Dental Materials', 'Preclinical Prosthodontics'],
    'Year 3': ['General Medicine', 'General Surgery', 'Oral Pathology & Microbiology'],
    'Year 4': ['Oral Medicine & Radiology', 'Paediatric & Preventive Dentistry', 'Orthodontics & Dentofacial Orthopaedics', 'Periodontology']
  }
};
const pdfRenderJobs = new Map();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureStorageReady() {
  ensureDir(STORAGE_DIR);
  ensureDir(UPLOADS_DIR);
  ensureDir(path.dirname(RENDERS_DIR));
}

function readRazorpayConfig() {
  if (!fs.existsSync(RAZORPAY_CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(RAZORPAY_CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function readData() {
  if (!fs.existsSync(DATA_FILE)) return { users: [], sessions: {}, notes: [], payments: [], paymentOrders: [] };
  try { const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); data.users ||= []; data.sessions ||= {}; data.notes ||= []; data.payments ||= []; data.paymentOrders ||= []; if (!data.users.some(user => user.isAdmin) && data.users[0] && !IS_PRODUCTION && !ADMIN_EMAIL) { data.users[0].isAdmin = true; fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); } return data; }
  catch { return { users: [], sessions: {}, notes: [], payments: [], paymentOrders: [] }; }
}
function writeData(data) { ensureStorageReady(); fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); }
function normalizeLabel(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function canonicalSubject(course, year, subject) {
  const subjects = COURSE_SUBJECTS[course]?.[year] || [];
  const normalized = normalizeLabel(subject);
  return subjects.find(item => normalizeLabel(item) === normalized) || '';
}
function hydrateCurriculumSubjects(data) {
  let changed = false;
  for (const note of data.notes || []) {
    const canonical = canonicalSubject(note.course, note.year, note.subject);
    if (canonical && note.subject !== canonical) {
      note.subject = canonical;
      changed = true;
    }
  }
  for (const user of data.users || []) {
    for (const item of user.library || []) {
      const canonical = canonicalSubject(item.course, item.year, item.subject);
      if (canonical && item.subject !== canonical) {
        item.subject = canonical;
        changed = true;
      }
    }
  }
  for (const payment of data.payments || []) {
    const canonical = canonicalSubject(payment.course, payment.year, payment.subject);
    if (canonical && payment.subject !== canonical) {
      payment.subject = canonical;
      changed = true;
    }
  }
  for (const order of data.paymentOrders || []) {
    const note = (data.notes || []).find(item => item.id === order.noteId);
    if (note && order.subject !== note.subject) {
      order.subject = note.subject;
      changed = true;
    }
  }
  if (changed) writeData(data);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function passwordIsValid(password, user) {
  const candidate = crypto.scryptSync(password, user.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x => {
    const i = x.indexOf('='); return [x.slice(0, i).trim(), decodeURIComponent(x.slice(i + 1))];
  }));
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, library: user.library || [], isAdmin: !!user.isAdmin }; }
function publicNote(note) {
  return {
    id: note.id,
    course: note.course,
    year: note.year,
    subject: note.subject,
    title: note.title,
    price: note.price,
    fileName: note.fileName,
    mimeType: note.mimeType,
    pageCount: note.pageCount || (note.mimeType === 'application/pdf' ? null : 1),
    uploadedAt: note.uploadedAt
  };
}
function publicPayment(payment, data) {
  const buyer = data.users.find(user => user.id === payment.userId);
  return {
    id: payment.id,
    buyerName: buyer ? buyer.name : payment.buyerName || 'Unknown user',
    buyerEmail: buyer ? buyer.email : payment.buyerEmail || '',
    noteTitle: payment.title,
    course: payment.course,
    year: payment.year,
    subject: payment.subject,
    amount: payment.amount,
    provider: payment.provider,
    status: payment.status,
    purchasedAt: payment.purchasedAt
  };
}
function publicPaymentConfig() {
  return {
    provider: 'razorpay',
    keyId: RAZORPAY_KEY_ID,
    enabled: Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET)
  };
}
function ensureUserSessionVersion(user) {
  if (!user) return 0;
  if (!Number.isInteger(user.sessionVersion) || user.sessionVersion < 0) user.sessionVersion = 0;
  return user.sessionVersion;
}
function sessionPayload(user, expiresAt) {
  return `${user.id}.${expiresAt}.${ensureUserSessionVersion(user)}`;
}
function sessionSignature(payload, user) {
  return crypto.createHmac('sha256', `${user.passwordHash}:${user.salt}`).update(payload).digest('hex');
}
function createSignedSessionToken(user, expiresAt = Date.now() + SESSION_TTL_MS) {
  const payload = sessionPayload(user, expiresAt);
  return `${payload}.${sessionSignature(payload, user)}`;
}
function parseSignedSessionToken(token) {
  const [userId, expiresAtRaw, sessionVersionRaw, signature] = String(token || '').trim().split('.');
  const expiresAt = Number(expiresAtRaw);
  const sessionVersion = Number(sessionVersionRaw);
  if (!userId || !Number.isFinite(expiresAt) || !Number.isInteger(sessionVersion) || !/^[a-f0-9]{64}$/i.test(signature || '')) return null;
  return { userId, expiresAt, sessionVersion, signature };
}
function resolveSignedSession(token, data) {
  const parsed = parseSignedSessionToken(token);
  if (!parsed || parsed.expiresAt < Date.now()) return null;
  const user = data.users.find(item => item.id === parsed.userId);
  if (!user) return null;
  if (ensureUserSessionVersion(user) !== parsed.sessionVersion) return null;
  const payload = `${parsed.userId}.${parsed.expiresAt}.${parsed.sessionVersion}`;
  const expected = sessionSignature(payload, user);
  if (expected.length !== parsed.signature.length || !crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parsed.signature, 'hex'))) return null;
  return { user, expiresAt: parsed.expiresAt };
}
function clearUserSessions(data, userId) {
  for (const [token, session] of Object.entries(data.sessions || {})) {
    if (session?.userId === userId) delete data.sessions[token];
  }
}
function syncAdminAccess(user, data) {
  if (!user || !ADMIN_EMAIL) return false;
  if (user.email === ADMIN_EMAIL && !user.isAdmin) {
    user.isAdmin = true;
    writeData(data);
    return true;
  }
  return false;
}
function computeAdminFlag(email, data) {
  if (ADMIN_EMAIL) return email === ADMIN_EMAIL;
  return !IS_PRODUCTION && !data.users.some(item => item.isAdmin);
}
function currentUser(req, data) {
  const token = parseCookies(req).inkly_session;
  const signedSession = token && resolveSignedSession(token, data);
  if (signedSession?.user) {
    syncAdminAccess(signedSession.user, data);
    return signedSession.user;
  }
  const session = token && data.sessions[token];
  if (!session || session.expiresAt < Date.now()) return null;
  const user = data.users.find(item => item.id === session.userId) || null;
  syncAdminAccess(user, data);
  return user;
}
function sessionCookie(token) { return `inkly_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${IS_PRODUCTION ? '; Secure' : ''}`; }
function clearCookie() { return `inkly_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${IS_PRODUCTION ? '; Secure' : ''}`; }
function createSession(data, user) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = createSignedSessionToken(user, expiresAt);
  data.sessions[token] = { userId: user.id, expiresAt };
  return token;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY_SIZE) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid request body')); } });
    req.on('error', reject);
  });
}
function validPassword(password) { return typeof password === 'string' && /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password); }
function validEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function noteFilePath(note) { return path.join(UPLOADS_DIR, `${note.id}${note.extension}`); }
function ownsNote(user, note) {
  if (!user || !note) return false;
  if (user.isAdmin) return true;
  return (user.library || []).some(item => item.noteId === note.id || (!item.noteId && item.course === note.course && item.year === note.year && item.subject === note.subject));
}
function safeFileName(name) { return String(name || 'notes.pdf').replace(/["\r\n]/g, ''); }
function activeSessions(data) {
  const now = Date.now();
  return Object.values(data.sessions).filter(session => session && session.expiresAt > now);
}
function hydrateLegacyPayments(data) {
  let changed = false;
  const known = new Set(data.payments.map(payment => `${payment.userId}|${payment.noteId || ''}|${payment.purchasedAt || ''}`));
  for (const user of data.users) {
    for (const item of user.library || []) {
      const note = item.noteId
        ? data.notes.find(candidate => candidate.id === item.noteId)
        : data.notes.find(candidate => candidate.course === item.course && candidate.year === item.year && candidate.subject === item.subject);
      const purchasedAt = item.purchasedAt || note?.uploadedAt;
      if (!note || !purchasedAt) continue;
      const key = `${user.id}|${note.id}|${purchasedAt}`;
      if (known.has(key)) continue;
      data.payments.push({
        id: crypto.randomUUID(),
        userId: user.id,
        noteId: note.id,
        title: note.title,
        course: note.course,
        year: note.year,
        subject: note.subject,
        amount: Number(item.price ?? note.price ?? 0),
        provider: 'inkly-local',
        status: 'paid',
        purchasedAt
      });
      known.add(key);
      changed = true;
    }
  }
  if (changed) writeData(data);
}
function razorpayRequest(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request({
      method: 'POST',
      hostname: 'api.razorpay.com',
      path: endpoint,
      headers: {
        Authorization: `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, response => {
      let chunks = '';
      response.on('data', chunk => { chunks += chunk; });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(chunks || '{}'); } catch { parsed = { error: { description: 'Invalid Razorpay response.' } }; }
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) return resolve(parsed);
        reject(new Error(parsed.error?.description || 'Razorpay request failed.'));
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}
function readPdfPageCount(note) {
  try {
    const output = execFileSync(PDFINFO_BIN, [noteFilePath(note)], { encoding: 'utf8', windowsHide: true });
    const match = output.match(/Pages:\s+(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
function pipeFile(res, file, headers, options = {}) {
  const missingStatus = options.missingStatus ?? 404;
  const missingError = options.missingError || 'File not found.';
  if (!fs.existsSync(file)) return send(res, missingStatus, { error: missingError });
  res.writeHead(200, headers);
  const stream = fs.createReadStream(file);
  stream.on('error', error => {
    console.error(`File stream error for ${file}:`, error);
    if (!res.writableEnded) {
      if (!res.headersSent) send(res, 500, { error: 'Unable to open the requested file right now.' });
      else res.end();
    }
  });
  stream.pipe(res);
  return stream;
}
function hydrateNoteMetadata(data) {
  let changed = false;
  for (const note of data.notes) {
    if (note.mimeType === 'application/pdf' && Number(note.pageCount) > 0) continue;
    const nextPageCount = note.mimeType === 'application/pdf' ? readPdfPageCount(note) : 1;
    if (nextPageCount && note.pageCount !== nextPageCount) {
      note.pageCount = nextPageCount;
      changed = true;
    }
  }
  if (changed) writeData(data);
}
function renderedPagePath(note, pageNumber) {
  return path.join(RENDERS_DIR, `${note.id}-page-${pageNumber}.png`);
}
function resolveRenderedPagePath(note, pageNumber) {
  const directPath = renderedPagePath(note, pageNumber);
  if (fs.existsSync(directPath)) return directPath;
  if (!fs.existsSync(RENDERS_DIR)) return null;
  const prefix = `${note.id}-page-`;
  const matched = fs.readdirSync(RENDERS_DIR).find(fileName => {
    if (!fileName.startsWith(prefix) || !fileName.endsWith('.png')) return false;
    const renderedNumber = Number(fileName.slice(prefix.length, -4));
    return Number.isInteger(renderedNumber) && renderedNumber === pageNumber;
  });
  return matched ? path.join(RENDERS_DIR, matched) : null;
}
function queueRenderRange(note, startPage, endPage) {
  if (!note || note.mimeType !== 'application/pdf' || !Number(note.pageCount)) return;
  const totalPages = Math.max(1, Number(note.pageCount || 1));
  const safeStart = Math.max(1, Number(startPage || 1));
  const safeEnd = Math.min(totalPages, Math.max(safeStart, Number(endPage || safeStart)));
  Promise.resolve()
    .then(() => renderPdfRange(note, safeStart, safeEnd))
    .catch(error => console.error(`Background PDF render failed for ${note.id} pages ${safeStart}-${safeEnd}:`, error));
}
function warmNotePages(note) {
  if (!note || note.mimeType !== 'application/pdf') return;
  const totalPages = Math.max(1, Number(note.pageCount || 1));
  queueRenderRange(note, 1, Math.min(totalPages, NOTE_WARM_PAGE_COUNT));
}
function warmNextPageWindow(note, pageNumber, previewOnly = false) {
  if (!note || note.mimeType !== 'application/pdf' || previewOnly) return;
  const totalPages = Math.max(1, Number(note.pageCount || 1));
  const nextStart = Number(pageNumber || 1) + 1;
  if (nextStart > totalPages) return;
  const nextEnd = Math.min(totalPages, nextStart + PDF_RENDER_BATCH_SIZE - 1);
  queueRenderRange(note, nextStart, nextEnd);
}
function previewRenderWindow(note) {
  return { start: 1, end: Math.min(Number(note.pageCount || 1), 5) };
}
function standardRenderWindow(note, pageNumber) {
  const totalPages = Math.max(1, Number(note.pageCount || 1));
  const start = Math.floor((pageNumber - 1) / PDF_RENDER_BATCH_SIZE) * PDF_RENDER_BATCH_SIZE + 1;
  return { start, end: Math.min(totalPages, start + PDF_RENDER_BATCH_SIZE - 1) };
}
async function renderPdfRange(note, startPage, endPage) {
  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const expectedPages = [];
  for (let page = startPage; page <= endPage; page += 1) expectedPages.push(page);
  const resolvedBeforeRender = expectedPages.map(page => resolveRenderedPagePath(note, page));
  if (resolvedBeforeRender.every(Boolean)) return resolvedBeforeRender;
  const jobKey = `${note.id}:${startPage}-${endPage}`;
  if (!pdfRenderJobs.has(jobKey)) {
    pdfRenderJobs.set(jobKey, Promise.resolve().then(() => {
      const resolvedExisting = expectedPages.map(page => resolveRenderedPagePath(note, page));
      if (resolvedExisting.every(Boolean)) return resolvedExisting;
      execFileSync(PDFTOPPM_BIN, ['-f', String(startPage), '-l', String(endPage), '-png', '-r', '144', noteFilePath(note), path.join(RENDERS_DIR, `${note.id}-page`)], { windowsHide: true });
      return expectedPages.map(page => resolveRenderedPagePath(note, page));
    }).finally(() => pdfRenderJobs.delete(jobKey)));
  }
  return pdfRenderJobs.get(jobKey);
}
async function renderPdfPage(note, pageNumber, previewOnly = false) {
  const window = previewOnly ? previewRenderWindow(note) : { start: pageNumber, end: pageNumber };
  await renderPdfRange(note, window.start, window.end);
  return resolveRenderedPagePath(note, pageNumber);
}

async function api(req, res) {
  const data = readData();
  hydrateCurriculumSubjects(data);
  hydrateLegacyPayments(data);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const user = currentUser(req, data);
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, environment: NODE_ENV });
  if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user: user ? publicUser(user) : null });
  if (req.method === 'POST' && url.pathname === '/api/signup') {
    const { name, email, password } = await readJson(req); const normalized = String(email || '').trim().toLowerCase();
    if (!String(name || '').trim() || !validEmail(normalized) || !validPassword(password)) return send(res, 400, { error: 'Enter a name, valid email and a strong password.' });
    if (data.users.some(item => item.email === normalized)) return send(res, 409, { error: 'An account already exists with this email.' });
    const secure = hashPassword(password); const newUser = { id: crypto.randomUUID(), name: String(name).trim(), email: normalized, passwordHash: secure.hash, salt: secure.salt, library: [], isAdmin: computeAdminFlag(normalized, data), sessionVersion: 0 };
    data.users.push(newUser); const token = createSession(data, newUser); writeData(data);
    return send(res, 201, { user: publicUser(newUser) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { email, password } = await readJson(req); const found = data.users.find(item => item.email === String(email || '').trim().toLowerCase());
    if (!found || !passwordIsValid(String(password || ''), found)) return send(res, 401, { error: 'Incorrect email or password.' });
    syncAdminAccess(found, data);
    const token = createSession(data, found); writeData(data); return send(res, 200, { user: publicUser(found) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/reset-password') {
    const { email, password } = await readJson(req);
    const found = data.users.find(item => item.email === String(email || '').trim().toLowerCase());
    if (!found) return send(res, 404, { error: 'No account was found with this email.' });
    if (!validPassword(password)) return send(res, 400, { error: 'Use 8+ characters with uppercase, lowercase and a number.' });
    const secure = hashPassword(password); found.passwordHash = secure.hash; found.salt = secure.salt;
    clearUserSessions(data, found.id);
    syncAdminAccess(found, data);
    const token = createSession(data, found); writeData(data);
    return send(res, 200, { user: publicUser(found) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = parseCookies(req).inkly_session;
    const signedSession = token && resolveSignedSession(token, data);
    const legacySession = token && data.sessions[token];
    const userId = signedSession?.user?.id || legacySession?.userId || '';
    if (signedSession?.user) signedSession.user.sessionVersion = ensureUserSessionVersion(signedSession.user) + 1;
    if (token) delete data.sessions[token];
    if (userId) clearUserSessions(data, userId);
    writeData(data);
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }
  if (!user) return send(res, 401, { error: 'Please log in to continue.' });
  if (req.method === 'GET' && url.pathname === '/api/payments/razorpay/config') return send(res, 200, publicPaymentConfig());
  if (req.method === 'GET' && url.pathname === '/api/notes') {
    hydrateNoteMetadata(data);
    for (const note of data.notes.filter(item => item.mimeType === 'application/pdf').slice(0, NOTE_WARM_LIMIT)) warmNotePages(note);
    return send(res, 200, { notes: data.notes.map(publicNote) });
  }
  const fileMatch = url.pathname.match(/^\/api\/notes\/([^/]+)\/file$/);
  const pageMatch = url.pathname.match(/^\/api\/notes\/([^/]+)\/pages\/(\d+)$/);
  if (req.method === 'GET' && fileMatch) {
    const note = data.notes.find(item => item.id === decodeURIComponent(fileMatch[1]));
    if (!note) return send(res, 404, { error: 'Note not found.' });
    const previewOnly = url.searchParams.get('preview') === '1';
    if (!previewOnly && !ownsNote(user, note)) return send(res, 403, { error: 'Purchase these notes before opening the full file.' });
    const file = noteFilePath(note);
    if (!fs.existsSync(file)) return send(res, 404, { error: 'Uploaded file is missing.' });
    return pipeFile(res, file, {
      'Content-Type': note.mimeType,
      'Content-Disposition': `inline; filename="${safeFileName(note.fileName)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }, { missingError: 'Uploaded file is missing.' });
  }
  if (req.method === 'GET' && pageMatch) {
    const note = data.notes.find(item => item.id === decodeURIComponent(pageMatch[1]));
    if (!note) return send(res, 404, { error: 'Note not found.' });
    if (note.mimeType !== 'application/pdf') return send(res, 400, { error: 'Rendered pages are available only for PDFs.' });
    const previewOnly = url.searchParams.get('preview') === '1';
    if (!previewOnly && !ownsNote(user, note)) return send(res, 403, { error: 'Purchase these notes before opening the full file.' });
    hydrateNoteMetadata(data);
    const pageNumber = Number(pageMatch[2]);
    const pageCount = note.pageCount || 1;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) return send(res, 404, { error: 'Page not found.' });
    if (previewOnly && !ownsNote(user, note) && pageNumber > 5) return send(res, 403, { error: 'Only the first 5 preview pages are available before purchase.' });
    const renderedPage = await renderPdfPage(note, pageNumber, previewOnly);
    if (!renderedPage) return send(res, 503, { error: 'This preview page is still being prepared. Please try again in a moment.' });
    warmNextPageWindow(note, pageNumber, previewOnly);
    return pipeFile(res, renderedPage, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }, { missingStatus: 503, missingError: 'This preview page is still being prepared. Please try again in a moment.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/notes') {
    if (!user.isAdmin) return send(res, 403, { error: 'Developer access is required.' });
    hydrateNoteMetadata(data);
    return send(res, 200, { notes: data.notes.map(publicNote) });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
    if (!user.isAdmin) return send(res, 403, { error: 'Developer access is required.' });
    hydrateNoteMetadata(data);
    const sessions = activeSessions(data);
    const activeUserIds = [...new Set(sessions.map(session => session.userId))];
    const activeUsers = activeUserIds.map(id => data.users.find(candidate => candidate.id === id)).filter(Boolean).map(activeUser => ({
      id: activeUser.id,
      name: activeUser.name,
      email: activeUser.email,
      libraryCount: (activeUser.library || []).length
    }));
    const payments = [...data.payments].sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime());
    const revenue = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return send(res, 200, {
      metrics: {
        totalUsers: data.users.length,
        activeUsers: activeUsers.length,
        activeSessions: sessions.length,
        totalNotes: data.notes.length,
        totalPayments: payments.length,
        revenue
      },
      activeUsers,
      payments: payments.map(payment => publicPayment(payment, data))
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/notes') {
    if (!user.isAdmin) return send(res, 403, { error: 'Developer access is required.' });
    const { course, year, subject, title, price, fileName, mimeType, fileData } = await readJson(req);
    if (![course, year, subject, title, fileName, fileData].every(value => typeof value === 'string' && value.trim())) return send(res, 400, { error: 'Complete all note details and choose a file.' });
    if (!['MBBS', 'BDS'].includes(course) || !/^Year [1-4]$/.test(year) || !Number.isFinite(Number(price)) || Number(price) < 0) return send(res, 400, { error: 'Enter valid course, year and price information.' });
    const subjectName = canonicalSubject(course, year, subject);
    if (!subjectName) return send(res, 400, { error: 'Choose a valid subject from the selected course and year.' });
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mimeType)) return send(res, 400, { error: 'Upload a PDF, JPG or PNG file.' });
    const bytes = Buffer.from(fileData, 'base64'); if (!bytes.length || bytes.length > 15_000_000) return send(res, 400, { error: 'The note file must be under 15 MB.' });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true }); const id = crypto.randomUUID(); const extension = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : '.jpg';
    const storedFile = path.join(UPLOADS_DIR, `${id}${extension}`);
    fs.writeFileSync(storedFile, bytes);
    const note = { id, course, year, subject: subjectName, title, price: Number(price), fileName, mimeType, extension, pageCount: mimeType === 'application/pdf' ? null : 1, uploadedBy: user.id, uploadedAt: new Date().toISOString() };
    if (mimeType === 'application/pdf') note.pageCount = readPdfPageCount(note);
    if (mimeType === 'application/pdf') warmNotePages(note);
    data.notes.unshift(note); writeData(data);
    return send(res, 201, { note: publicNote(note) });
  }
  if (req.method === 'PATCH' && url.pathname === '/api/profile') {
    const { name } = await readJson(req); if (!String(name || '').trim()) return send(res, 400, { error: 'A display name is required.' });
    user.name = String(name).trim(); writeData(data); return send(res, 200, { user: publicUser(user) });
  }
  if (req.method === 'POST' && url.pathname === '/api/purchases') {
    const { noteId } = await readJson(req);
    const note = data.notes.find(item => item.id === String(noteId || '').trim());
    if (!note) return send(res, 404, { error: 'Choose an uploaded note before checkout.' });
    user.library ||= [];
    const existing = user.library.find(item => item.noteId === note.id || (!item.noteId && item.course === note.course && item.year === note.year && item.subject === note.subject));
    if (existing) Object.assign(existing, { noteId: note.id, title: note.title, price: note.price });
    else user.library.push({ noteId: note.id, course: note.course, year: note.year, subject: note.subject, title: note.title, price: note.price, purchasedAt: new Date().toISOString() });
    const purchasedAt = existing?.purchasedAt || user.library.find(item => item.noteId === note.id)?.purchasedAt || new Date().toISOString();
    if (!data.payments.some(payment => payment.userId === user.id && payment.noteId === note.id && payment.purchasedAt === purchasedAt)) {
      data.payments.unshift({
        id: crypto.randomUUID(),
        userId: user.id,
        noteId: note.id,
        title: note.title,
        course: note.course,
        year: note.year,
        subject: note.subject,
        amount: Number(note.price || 0),
        provider: 'inkly-local',
        status: 'paid',
        purchasedAt
      });
    }
    writeData(data); return send(res, 200, { library: user.library });
  }
  if (req.method === 'POST' && url.pathname === '/api/payments/razorpay/order') {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return send(res, 400, { error: 'Razorpay is not fully configured yet. Add the Razorpay Key Secret on the server.' });
    const { noteId } = await readJson(req);
    const note = data.notes.find(item => item.id === String(noteId || '').trim());
    if (!note) return send(res, 404, { error: 'Choose an uploaded note before checkout.' });
    const existingPurchase = (user.library || []).find(item => item.noteId === note.id || (!item.noteId && item.course === note.course && item.year === note.year && item.subject === note.subject));
    if (existingPurchase) return send(res, 409, { error: 'You already own these notes.' });
    const amount = Math.round(Number(note.price || 0) * 100);
    if (!amount) return send(res, 400, { error: 'This note does not have a valid payment amount yet.' });
    const razorpayOrder = await razorpayRequest('/v1/orders', {
      amount,
      currency: 'INR',
      receipt: `inkly_${Date.now()}`,
      notes: {
        note_id: note.id,
        course: note.course,
        subject: note.subject
      }
    });
    data.paymentOrders.unshift({
      id: crypto.randomUUID(),
      userId: user.id,
      noteId: note.id,
      razorpayOrderId: razorpayOrder.id,
      amount,
      currency: razorpayOrder.currency || 'INR',
      status: razorpayOrder.status || 'created',
      createdAt: new Date().toISOString()
    });
    writeData(data);
    return send(res, 200, {
      keyId: RAZORPAY_KEY_ID,
      razorpayOrderId: razorpayOrder.id,
      amount,
      currency: razorpayOrder.currency || 'INR',
      note: publicNote(note)
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/payments/razorpay/verify') {
    if (!RAZORPAY_KEY_SECRET) return send(res, 400, { error: 'Razorpay Key Secret is missing on the server.' });
    const { noteId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = await readJson(req);
    const note = data.notes.find(item => item.id === String(noteId || '').trim());
    if (!note) return send(res, 404, { error: 'Note not found.' });
    const orderRecord = data.paymentOrders.find(order => order.userId === user.id && order.noteId === note.id && order.razorpayOrderId === String(razorpay_order_id || '').trim());
    if (!orderRecord) return send(res, 404, { error: 'Payment order not found.' });
    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderRecord.razorpayOrderId}|${String(razorpay_payment_id || '').trim()}`).digest('hex');
    const received = String(razorpay_signature || '').trim();
    if (expected.length !== received.length || !crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'))) {
      return send(res, 400, { error: 'Razorpay signature verification failed.' });
    }
    user.library ||= [];
    const existing = user.library.find(item => item.noteId === note.id || (!item.noteId && item.course === note.course && item.year === note.year && item.subject === note.subject));
    const purchasedAt = new Date().toISOString();
    if (existing) Object.assign(existing, { noteId: note.id, title: note.title, price: note.price, purchasedAt });
    else user.library.push({ noteId: note.id, course: note.course, year: note.year, subject: note.subject, title: note.title, price: note.price, purchasedAt });
    orderRecord.status = 'paid';
    orderRecord.razorpayPaymentId = String(razorpay_payment_id || '').trim();
    orderRecord.verifiedAt = purchasedAt;
    if (!data.payments.some(payment => payment.userId === user.id && payment.noteId === note.id && payment.razorpayPaymentId === orderRecord.razorpayPaymentId)) {
      data.payments.unshift({
        id: crypto.randomUUID(),
        userId: user.id,
        noteId: note.id,
        title: note.title,
        course: note.course,
        year: note.year,
        subject: note.subject,
        amount: Number(note.price || 0),
        provider: 'razorpay',
        status: 'paid',
        purchasedAt,
        razorpayOrderId: orderRecord.razorpayOrderId,
        razorpayPaymentId: orderRecord.razorpayPaymentId
      });
    }
    writeData(data);
    return send(res, 200, { library: user.library });
  }
  return send(res, 404, { error: 'Not found.' });
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
ensureStorageReady();
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health' || req.url.startsWith('/api/')) return await api(req, res);
    const requested = req.url === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname;
    if (requested.startsWith('/uploads/')) return res.writeHead(404).end('Not found');
    const file = path.resolve(ROOT, `.${requested}`);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('Not found');
    return pipeFile(res, file, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }, { missingError: 'Static file not found.' });
  } catch (error) { send(res, 500, { error: error.message || 'Server error.' }); }
});
server.listen(PORT, () => console.log(`Inkly server listening on port ${PORT} (${NODE_ENV})`));
