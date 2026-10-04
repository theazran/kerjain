// KERJAIN — Catat. Kerjakan. Buktikan.
// Server tunggal: Express + EJS, Google Sheets sebagai database, Google Drive untuk evidence.
require('dotenv').config({ quiet: true });

const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const session = require('express-session');
const compression = require('compression');
const multer = require('multer');
const { OAuth2Client } = require('google-auth-library');
const { sheets: sheetsApi } = require('@googleapis/sheets');
const { drive: driveApi } = require('@googleapis/drive');

const env = process.env;
const PORT = Number(env.PORT) || 3000;
const TZ = env.APP_TIMEZONE || 'Asia/Jakarta';
const IS_PROD = env.NODE_ENV === 'production';
const MAX_FILE_MB = Number(env.MAX_FILE_MB) || 10;
const PAGE_SIZE = 20;
const CACHE_TTL = 60 * 1000;

for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'SESSION_SECRET']) {
  if (!env[key]) console.warn(`[KERJAIN] Variabel ${key} belum diisi di .env`);
}

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

// ─── Konstanta domain ────────────────────────────────────────────────────────

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const STATUS = ['Selesai', 'Berjalan'];
const JENIS = ['Troubleshooting', 'Monitoring', 'Helpdesk', 'Pemeliharaan', 'Pengembangan', 'Administrasi'];
const SUB_IT = ['SIPP', 'SIKEP', 'e-Court', 'e-Berpadu', 'TTE', 'PTSP', 'Jaringan', 'Internet', 'Komputer', 'Printer', 'CCTV', 'Server', 'Website', 'Aplikasi', 'Database', 'Keamanan', 'Monitoring', 'Pengembangan', 'Lainnya'];
const DEFAULT_KATEGORI = {
  'IT / PTIP': SUB_IT,
  'Umum': ['Administrasi', 'Persuratan', 'Kearsipan', 'Rapat', 'Lainnya'],
  'Keuangan': ['Pembayaran', 'Pelaporan', 'Administrasi', 'Lainnya'],
  'Bantuan Pegawai': SUB_IT,
  'Sarana & Prasarana': ['Perbaikan', 'Pemeliharaan', 'Pengadaan', 'Inventaris', 'Lainnya'],
  'Lainnya': [],
};
const KATEGORI_PENDEK = { 'IT / PTIP': 'IT', 'Umum': 'Umum', 'Keuangan': 'Keu', 'Bantuan Pegawai': 'Bantuan', 'Sarana & Prasarana': 'Sarpras', 'Lainnya': 'Lain' };
const DEFAULT_RUTIN = ['Monitoring Server', 'Monitoring CCTV', 'Monitoring Website', 'Pemeriksaan Storage', 'Backup', 'Pemeriksaan Jaringan'];
const SETTING_FIELDS = [
  ['nama_instansi', 'Nama Instansi'],
  ['nama_pengguna', 'Nama Pengguna'],
  ['nip', 'NIP'],
  ['jabatan', 'Jabatan'],
  ['unit', 'Unit'],
  ['tahun', 'Tahun'],
];

// Skema sheet. Kolom pertama `id` dipakai untuk update/hapus.
const SCHEMA = {
  pekerjaan: ['id', 'tanggal', 'waktu_mulai', 'waktu_selesai', 'kategori', 'subkategori', 'judul', 'uraian', 'masalah', 'tindakan', 'hasil', 'pegawai', 'status', 'drive_folder_id', 'drive_folder_url', 'created_at', 'updated_at', 'jenis', 'jumlah_evidence'],
  pegawai: ['nama', 'unit', 'created_at'],
  kategori: ['kategori', 'subkategori'],
  pengaturan: ['kunci', 'nilai'],
  rutin: ['id', 'judul', 'kategori', 'subkategori', 'created_at'],
  knowledge: ['id', 'kelompok', 'judul', 'masalah', 'penyebab', 'solusi', 'evidence_url', 'created_at', 'updated_at'],
};

// ─── Utilitas tanggal & teks ─────────────────────────────────────────────────

function nowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, stamp: `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}` };
}
const today = () => nowParts().date;

function tglPanjang(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]} ${BULAN[Number(m[2]) - 1]} ${m[1]}` : iso || '';
}
function tglPendek(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '';
}
// Durasi dari jam mulai & selesai, misalnya "1 jam 15 menit".
function durasi(mulai, selesai) {
  if (!isTime(mulai) || !isTime(selesai)) return '';
  const [h1, m1] = mulai.split(':').map(Number);
  const [h2, m2] = selesai.split(':').map(Number);
  const menit = h2 * 60 + m2 - (h1 * 60 + m1);
  if (menit <= 0) return '';
  const jam = Math.floor(menit / 60);
  return [jam ? `${jam} jam` : '', menit % 60 ? `${menit % 60} menit` : ''].filter(Boolean).join(' ');
}

function hariNama(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][d.getUTCDay()] || '';
}

// Bersihkan teks: buang karakter kontrol, rapikan spasi, batasi panjang.
function clean(value, max = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const safeUrl = (v) => (/^https:\/\/[^\s<>"']+$/i.test(v) ? v : '');
const normal = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// Tebak jenis pekerjaan bila kolom `jenis` kosong (untuk statistik).
function jenisOf(p) {
  if (p.jenis) return p.jenis;
  if (p.kategori === 'Bantuan Pegawai' || p.pegawai) return 'Helpdesk';
  if (p.subkategori === 'Monitoring' || /monitor/i.test(p.judul)) return 'Monitoring';
  if (p.subkategori === 'Pengembangan') return 'Pengembangan';
  if (p.masalah) return 'Troubleshooting';
  if (/backup|pemeliharaan|perawatan|pemeriksaan|servis/i.test(p.judul)) return 'Pemeliharaan';
  if (['Umum', 'Keuangan'].includes(p.kategori)) return 'Administrasi';
  return 'Lainnya';
}

function countBy(list, fn) {
  const map = new Map();
  for (const item of list) {
    const key = fn(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
}

// Masalah berulang: dikelompokkan dari teks masalah yang dinormalisasi.
function masalahTerbanyak(list, limit = 8) {
  const map = new Map();
  for (const p of list) {
    const key = normal(p.masalah);
    if (!key) continue;
    const row = map.get(key) || { label: p.masalah.split('\n')[0].slice(0, 60), total: 0 };
    row.total += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

// ─── Error ───────────────────────────────────────────────────────────────────

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.userMessage = message; }
}

function isAuthError(err) {
  const text = String(err?.message || '') + String(err?.response?.data?.error || '');
  return /invalid_grant|invalid_token|unauthorized|No refresh token|Login Required/i.test(text) || err?.code === 401 || err?.status === 401;
}

// Detail teknis hanya ke log server; pengguna menerima pesan yang ramah.
function fail(req, res, err, message = 'Data belum berhasil disimpan. Silakan coba kembali.') {
  if (err instanceof UserError) return res.status(err.status).json({ ok: false, message: err.userMessage });
  console.error(`[KERJAIN] ${req.method} ${req.originalUrl}`, err);
  if (isAuthError(err)) {
    req.session.destroy(() => {});
    return res.status(401).json({ ok: false, message: 'Sesi Google berakhir. Silakan masuk kembali.', login: true });
  }
  return res.status(500).json({ ok: false, message });
}

// ─── Google: OAuth, Sheets, Drive ────────────────────────────────────────────

function oauthClient() {
  return new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

// Konteks per permintaan: klien Google memakai token milik sesi pengguna.
function googleCtx(req) {
  const g = req.session.google;
  const auth = oauthClient();
  auth.setCredentials(g.tokens);
  auth.on('tokens', (tokens) => {
    g.tokens = { ...g.tokens, ...tokens };
    req.session.save(() => {});
  });
  return {
    g,
    sheets: sheetsApi({ version: 'v4', auth }),
    drive: driveApi({ version: 'v3', auth }),
    get sid() { return g.spreadsheetId; },
  };
}

const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const sheetRange = (name) => `${name}!A1:${colLetter(SCHEMA[name].length)}`;

function seedRows(name) {
  if (name === 'kategori') return Object.entries(DEFAULT_KATEGORI).flatMap(([k, subs]) => (subs.length ? subs.map((s) => [k, s]) : [[k, '']]));
  if (name === 'pengaturan') return SETTING_FIELDS.map(([key]) => [key, key === 'tahun' ? today().slice(0, 4) : '']);
  if (name === 'rutin') {
    const stamp = nowParts().stamp;
    return DEFAULT_RUTIN.map((judul, i) => [`RTN-${String(i + 1).padStart(3, '0')}`, judul, 'IT / PTIP', judul.startsWith('Monitoring') ? 'Monitoring' : '', stamp]);
  }
  return [];
}

// Pastikan spreadsheet & folder utama tersedia. Dipanggil saat login.
async function setupGoogle(ctx) {
  const { g, drive, sheets } = ctx;

  // Spreadsheet: dari .env, atau cari/buat milik aplikasi (ditandai appProperties).
  if (!g.spreadsheetId) {
    if (env.GOOGLE_SPREADSHEET_ID) g.spreadsheetId = env.GOOGLE_SPREADSHEET_ID;
    else {
      const found = await drive.files.list({
        q: "appProperties has { key='kerjain' and value='database' } and trashed = false",
        fields: 'files(id)', pageSize: 1, spaces: 'drive',
      });
      if (found.data.files.length) g.spreadsheetId = found.data.files[0].id;
      else {
        const created = await drive.files.create({
          requestBody: { name: 'KERJAIN Database', mimeType: 'application/vnd.google-apps.spreadsheet', appProperties: { kerjain: 'database' } },
          fields: 'id',
        });
        g.spreadsheetId = created.data.id;
      }
    }
  }

  // Tambahkan sheet yang belum ada beserta header & data awal.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: g.spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  const existing = meta.data.sheets.map((s) => s.properties);
  const missing = Object.keys(SCHEMA).filter((name) => !existing.some((s) => s.title === name));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: g.spreadsheetId,
      requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: g.spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: missing.map((name) => ({ range: sheetRange(name), values: [SCHEMA[name], ...seedRows(name)] })) },
    });
    // Hapus "Sheet1" bawaan bila spreadsheet baru dibuat.
    const blank = existing.find((s) => /^(Sheet1|Sheet 1|Lembar1|Lembar 1)$/.test(s.title));
    if (blank && existing.length === 1) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: g.spreadsheetId, requestBody: { requests: [{ deleteSheet: { sheetId: blank.sheetId } }] } }).catch(() => {});
    }
  }
  g.sheetIds = null;

  // Folder utama evidence.
  if (!g.folderId) {
    if (env.GOOGLE_DRIVE_FOLDER_ID) g.folderId = env.GOOGLE_DRIVE_FOLDER_ID;
    else {
      const found = await drive.files.list({
        q: "appProperties has { key='kerjain' and value='root' } and trashed = false",
        fields: 'files(id)', pageSize: 1, spaces: 'drive',
      });
      g.folderId = found.data.files[0]?.id || (await drive.files.create({
        requestBody: { name: 'KERJAIN', mimeType: 'application/vnd.google-apps.folder', appProperties: { kerjain: 'root' } },
        fields: 'id',
      })).data.id;
    }
  }
}

// Cache baca sheet per spreadsheet agar halaman tetap cepat.
const cache = new Map();
const cacheKey = (ctx, name) => `${ctx.sid}:${name}`;
const invalidate = (ctx, name) => cache.delete(cacheKey(ctx, name));

async function readSheet(ctx, name, { fresh = false } = {}) {
  const key = cacheKey(ctx, name);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL) return hit.rows;
  const res = await ctx.sheets.spreadsheets.values.get({ spreadsheetId: ctx.sid, range: sheetRange(name) });
  const cols = SCHEMA[name];
  const values = res.data.values || [];
  const header = values[0] || cols;
  const rows = values.slice(1).map((r, i) => {
    const obj = { _row: i + 2 };
    cols.forEach((c) => { const idx = header.indexOf(c); obj[c] = idx >= 0 ? String(r[idx] ?? '') : ''; });
    return obj;
  }).filter((o) => cols.some((c) => o[c] !== ''));
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

const toRow = (name, obj) => SCHEMA[name].map((c) => (obj[c] ?? '').toString());

// Antrian tulis sederhana per spreadsheet agar ID tidak bentrok.
const locks = new Map();
function withLock(ctx, fn) {
  const prev = locks.get(ctx.sid) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(ctx.sid, next);
  return next;
}

async function appendRows(ctx, name, objs) {
  await ctx.sheets.spreadsheets.values.append({
    spreadsheetId: ctx.sid, range: sheetRange(name), valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: objs.map((o) => toRow(name, o)) },
  });
  invalidate(ctx, name);
}

async function findFresh(ctx, name, id) {
  const rows = await readSheet(ctx, name, { fresh: true });
  const row = rows.find((r) => r.id === id);
  if (!row) throw new UserError('Data tidak ditemukan.', 404);
  return row;
}

async function updateRow(ctx, name, id, patch) {
  return withLock(ctx, async () => {
    const row = await findFresh(ctx, name, id);
    const merged = { ...row, ...patch, id };
    if ('updated_at' in row) merged.updated_at = nowParts().stamp;
    await ctx.sheets.spreadsheets.values.update({
      spreadsheetId: ctx.sid, range: `${name}!A${row._row}:${colLetter(SCHEMA[name].length)}${row._row}`,
      valueInputOption: 'RAW', requestBody: { values: [toRow(name, merged)] },
    });
    invalidate(ctx, name);
    return merged;
  });
}

async function sheetId(ctx, name) {
  if (!ctx.g.sheetIds) {
    const meta = await ctx.sheets.spreadsheets.get({ spreadsheetId: ctx.sid, fields: 'sheets.properties(sheetId,title)' });
    ctx.g.sheetIds = Object.fromEntries(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  }
  return ctx.g.sheetIds[name];
}

async function deleteRow(ctx, name, id) {
  return withLock(ctx, async () => {
    const row = await findFresh(ctx, name, id);
    await ctx.sheets.spreadsheets.batchUpdate({
      spreadsheetId: ctx.sid,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId: await sheetId(ctx, name), dimension: 'ROWS', startIndex: row._row - 1, endIndex: row._row } } }] },
    });
    invalidate(ctx, name);
  });
}

// ─── Data aplikasi ───────────────────────────────────────────────────────────

async function getSettings(ctx) {
  const rows = await readSheet(ctx, 'pengaturan');
  const s = Object.fromEntries(SETTING_FIELDS.map(([k]) => [k, '']));
  for (const r of rows) if (r.kunci in s) s[r.kunci] = r.nilai;
  return s;
}

async function getKategori(ctx) {
  const rows = await readSheet(ctx, 'kategori');
  const map = {};
  for (const r of rows) {
    if (!r.kategori) continue;
    map[r.kategori] = map[r.kategori] || [];
    if (r.subkategori && !map[r.kategori].includes(r.subkategori)) map[r.kategori].push(r.subkategori);
  }
  return Object.keys(map).length ? map : DEFAULT_KATEGORI;
}

async function getPekerjaan(ctx) {
  const rows = await readSheet(ctx, 'pekerjaan');
  return rows.map((p) => ({ ...p, evidence: Number(p.jumlah_evidence) || 0 }))
    .sort((a, b) => (b.tanggal + b.waktu_mulai + b.created_at).localeCompare(a.tanggal + a.waktu_mulai + a.created_at));
}

function searchText(p) {
  return normal([p.id, p.judul, p.uraian, p.kategori, p.subkategori, p.pegawai, p.masalah, p.tindakan, p.hasil, p.status, tglPanjang(p.tanggal), tglPendek(p.tanggal), p.tanggal].join(' '));
}

function filterPekerjaan(list, f) {
  const terms = normal(f.q).split(' ').filter(Boolean);
  return list.filter((p) => {
    if (f.bulan && f.tahun && p.tanggal.slice(0, 7) !== `${f.tahun}-${String(f.bulan).padStart(2, '0')}`) return false;
    if (!f.bulan && f.tahun && p.tanggal.slice(0, 4) !== String(f.tahun)) return false;
    if (f.tanggal && p.tanggal !== f.tanggal) return false;
    if (f.kategori && p.kategori !== f.kategori) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.evidence && !p.evidence && !p.drive_folder_url) return false;
    if (terms.length) { const hay = searchText(p); if (!terms.every((t) => hay.includes(t))) return false; }
    return true;
  });
}

// Validasi input form pekerjaan. Hanya judul & kategori yang wajib.
function parsePekerjaan(body, kategoriMap, base = {}) {
  const data = {
    tanggal: clean(body.tanggal, 10) || base.tanggal || today(),
    waktu_mulai: clean(body.waktu_mulai, 5),
    waktu_selesai: clean(body.waktu_selesai, 5),
    kategori: clean(body.kategori, 60),
    subkategori: clean(body.subkategori, 60),
    judul: clean(body.judul, 200),
    uraian: clean(body.uraian, 3000),
    masalah: clean(body.masalah, 1000),
    tindakan: clean(body.tindakan, 2000),
    hasil: clean(body.hasil, 1000),
    pegawai: clean(body.pegawai, 120),
    status: clean(body.status, 20) || 'Selesai',
    jenis: clean(body.jenis, 30),
  };
  if (!data.judul) throw new UserError('Judul pekerjaan wajib diisi.');
  if (!kategoriMap[data.kategori]) throw new UserError('Pilih kategori pekerjaan.');
  if (!isDate(data.tanggal)) throw new UserError('Format tanggal tidak valid.');
  if (data.waktu_mulai && !isTime(data.waktu_mulai)) throw new UserError('Format waktu mulai tidak valid.');
  if (data.waktu_selesai && !isTime(data.waktu_selesai)) throw new UserError('Format waktu selesai tidak valid.');
  if (!STATUS.includes(data.status)) throw new UserError('Status tidak valid.');
  if (data.jenis && !JENIS.includes(data.jenis)) data.jenis = '';
  return data;
}

async function createPekerjaan(ctx, items) {
  return withLock(ctx, async () => {
    const rows = await readSheet(ctx, 'pekerjaan', { fresh: true });
    const stamp = nowParts().stamp;
    const created = items.map((data) => {
      const prefix = `LOG-${data.tanggal}-`;
      const seq = rows.filter((r) => r.id.startsWith(prefix)).reduce((max, r) => Math.max(max, Number(r.id.slice(prefix.length)) || 0), 0) + 1;
      const obj = { ...data, id: prefix + String(seq).padStart(3, '0'), created_at: stamp, updated_at: stamp, jumlah_evidence: '0' };
      rows.push(obj);
      return obj;
    });
    await appendRows(ctx, 'pekerjaan', created);
    return created;
  });
}

// Simpan nama pegawai baru ke sheet pegawai (untuk saran isian).
async function rememberPegawai(ctx, nama) {
  if (!nama) return;
  const rows = await readSheet(ctx, 'pegawai');
  if (rows.some((r) => normal(r.nama) === normal(nama))) return;
  await appendRows(ctx, 'pegawai', [{ nama, unit: '', created_at: nowParts().stamp }]);
}

// ─── Google Drive: folder & upload evidence ──────────────────────────────────

const folderCache = new Map();
const driveName = (v) => clean(v, 120).replace(/[\\/:*?"<>|#]/g, '-').replace(/'/g, '’');

async function childFolder(ctx, parentId, name) {
  const key = `${parentId}/${name}`;
  if (folderCache.has(key)) return folderCache.get(key);
  const found = await ctx.drive.files.list({
    q: `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)', pageSize: 1,
  });
  const id = found.data.files[0]?.id || (await ctx.drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }, fields: 'id',
  })).data.id;
  folderCache.set(key, id);
  return id;
}

// KERJAIN / 2026 / 10 Oktober / LOG-2026-10-04-001 - Judul
async function ensureEvidenceFolder(ctx, p) {
  if (p.drive_folder_id) return p;
  const [y, m] = p.tanggal.split('-');
  const yearId = await childFolder(ctx, ctx.g.folderId, y);
  const monthId = await childFolder(ctx, yearId, `${m} ${BULAN[Number(m) - 1]}`);
  const folder = await ctx.drive.files.create({
    requestBody: { name: driveName(`${p.id} - ${p.judul}`), mimeType: 'application/vnd.google-apps.folder', parents: [monthId] },
    fields: 'id, webViewLink',
  });
  return updateRow(ctx, 'pekerjaan', p.id, { drive_folder_id: folder.data.id, drive_folder_url: folder.data.webViewLink });
}

const ALLOWED_FILES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'text/plain': ['txt'],
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 10 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').slice(1).toLowerCase();
    const okExt = ALLOWED_FILES[file.mimetype];
    if (!okExt || !okExt.includes(ext)) return cb(new UserError('Tipe file tidak didukung. Gunakan foto, PDF, atau dokumen Office.'));
    cb(null, true);
  },
}).array('files', 10);

function safeFileName(original) {
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, path.extname(original)).replace(/[^\p{L}\p{N}._ -]/gu, '').trim().slice(0, 80) || 'evidence';
  return base + ext;
}

// Ikon garis sederhana (inline SVG) untuk navigasi.
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  calendar: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  report: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  check: 'M5 12.5 10 17 19 7',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  chart: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
  table: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zM9 12l2 2 4-4',
  share: 'M12 3v12M8 7l4-4 4 4M5 11v9h14v-9',
  addSquare: 'M4 4h16v16H4zM12 8v8M8 12h8',
  phone: 'M7 2h10v20H7zM11 18h2',
  checkCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12.5l2.7 2.5L16 9.5',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
};
const icon = (name, cls = 'h-5 w-5') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

// ─── Aplikasi Express ────────────────────────────────────────────────────────

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(compression());
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

// Versi aset dari waktu build agar browser & service worker selalu memuat CSS/JS terbaru.
const fs = require('fs');
function assetVersion(file) {
  try { return Math.floor(fs.statSync(path.join(__dirname, 'public', file)).mtimeMs).toString(36); } catch (e) {
    console.error(`[KERJAIN] public/${file} tidak ditemukan. Jalankan: npm run build:css`);
    return '0';
  }
}
const ASSET_V = { css: assetVersion('app.css'), js: assetVersion('app.js') };

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '7d' : 0,
  setHeaders(res, file) {
    if (file.endsWith('.webmanifest')) res.set('Content-Type', 'application/manifest+json');
    if (file.endsWith('sw.js')) res.set('Cache-Control', 'no-cache');
  },
}));

// Library frontend disajikan dari node_modules, dimuat hanya di halaman yang butuh.
const vendor = {
  'fullcalendar.js': 'fullcalendar/index.global.min.js',
  'fullcalendar-id.js': '@fullcalendar/core/locales/id.global.min.js',
  'chart.js': 'chart.js/dist/chart.umd.min.js',
};
app.get('/vendor/:file', (req, res, next) => {
  const file = vendor[req.params.file];
  if (!file) return next();
  res.sendFile(path.join(__dirname, 'node_modules', file), { maxAge: '30d' });
});

// Sesi disimpan ke satu file terenkripsi (AES-256-GCM, kunci dari SESSION_SECRET)
// agar pengguna tidak perlu login ulang setiap server restart.
class FileStore extends session.Store {
  constructor(file, secret) {
    super();
    this.file = file;
    this.key = crypto.createHash('sha256').update(`kerjain-session:${secret}`).digest();
    this.sessions = new Map();
    this.timer = null;
    this.load();
    setInterval(() => this.prune(), 60 * 60 * 1000).unref();
  }

  expiresAt(sess) {
    const exp = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    return Number.isFinite(exp) ? exp : Date.now() + 24 * 60 * 60 * 1000;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
      this.sessions = new Map(Object.entries(JSON.parse(json)));
      this.prune();
    } catch (err) {
      // File belum ada, atau SESSION_SECRET berubah: mulai dengan sesi kosong.
      if (err.code !== 'ENOENT') console.warn('[KERJAIN] File sesi tidak dapat dibaca, sesi lama diabaikan.');
    }
  }

  // Tulis atomik: file sementara lalu rename, agar file tidak rusak bila server mati saat menulis.
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(Object.fromEntries(this.sessions)), 'utf8'), cipher.final()]);
      fs.writeFileSync(`${this.file}.tmp`, Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 });
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      console.error('[KERJAIN] Gagal menyimpan file sesi', err);
    }
  }

  schedule() {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 1000);
  }

  prune() {
    const now = Date.now();
    let changed = false;
    for (const [sid, sess] of this.sessions) if (this.expiresAt(sess) <= now) { this.sessions.delete(sid); changed = true; }
    if (changed) this.schedule();
  }

  get(sid, cb) {
    const sess = this.sessions.get(sid);
    if (sess && this.expiresAt(sess) <= Date.now()) { this.destroy(sid, () => cb(null, null)); return; }
    cb(null, sess ? JSON.parse(JSON.stringify(sess)) : null);
  }

  set(sid, sess, cb) {
    this.sessions.set(sid, JSON.parse(JSON.stringify(sess)));
    this.schedule();
    cb?.(null);
  }

  touch(sid, sess, cb) {
    const current = this.sessions.get(sid);
    if (current) { current.cookie = JSON.parse(JSON.stringify(sess.cookie)); this.schedule(); }
    cb?.(null);
  }

  destroy(sid, cb) {
    this.sessions.delete(sid);
    this.schedule();
    cb?.(null);
  }
}

const sessionStore = new FileStore(path.resolve(__dirname, env.SESSION_FILE || '.sessions'), env.SESSION_SECRET || 'ganti-session-secret');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { sessionStore.flush(); process.exit(0); });

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'kerjain.sid',
  secret: env.SESSION_SECRET || 'ganti-session-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: sessionStore,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

// Variabel yang tersedia di semua view.
function viewLocals(req, res) {
  const g = req.session?.google;
  Object.assign(res.locals, {
    path: req.path, tglPanjang, tglPendek, hariNama, KATEGORI_PENDEK, STATUS, JENIS, BULAN,
    user: g?.spreadsheetId ? { email: g.email, name: g.name } : null,
    hariIni: today(), icon, ASSET_V, durasi,
  });
}
app.use((req, res, next) => { viewLocals(req, res); next(); });

// ─── Auth ────────────────────────────────────────────────────────────────────

const allowedEmails = (env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

app.get('/masuk', (req, res) => {
  if (req.session.google?.spreadsheetId) return res.redirect('/');
  const pesan = { gagal: 'Akun Google belum berhasil dihubungkan. Silakan coba kembali.', ditolak: 'Akun Google ini tidak memiliki akses ke aplikasi.' }[req.query.e] || '';
  res.render('masuk', { title: 'Masuk', pesan });
});

app.get('/auth/google', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, include_granted_scopes: true });
  req.session.save(() => res.redirect(url));
});

app.get('/auth/callback', async (req, res) => {
  try {
    if (!req.query.code || !req.query.state || req.query.state !== req.session.oauthState) throw new Error('OAuth state tidak cocok');
    const client = oauthClient();
    const { tokens } = await client.getToken(String(req.query.code));
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    const email = String(profile.email || '').toLowerCase();
    if (allowedEmails.length && !allowedEmails.includes(email)) return res.redirect('/masuk?e=ditolak');
    const granted = String(tokens.scope || '');
    if (!granted.includes('spreadsheets') || !granted.includes('drive.file')) throw new Error(`Izin belum lengkap: ${granted}`);

    await new Promise((ok, no) => req.session.regenerate((e) => (e ? no(e) : ok())));
    req.session.google = { tokens, email, name: profile.name || email };
    await setupGoogle(googleCtx(req));
    req.session.save(() => res.redirect('/'));
  } catch (err) {
    console.error('[KERJAIN] OAuth callback', err);
    delete req.session.google;
    res.redirect('/masuk?e=gagal');
  }
});

app.post('/keluar', (req, res) => {
  const tokens = req.session.google?.tokens;
  req.session.destroy(() => {
    if (tokens?.access_token) oauthClient().revokeToken(tokens.access_token).catch(() => {});
    res.clearCookie('kerjain.sid');
    res.redirect('/masuk');
  });
});

// Halaman utama publik: pengunjung yang belum masuk melihat landing page.
app.get('/', (req, res, next) => {
  if (req.session.google?.spreadsheetId) return next();
  res.render('landing', { tahun: today().slice(0, 4) });
});

// Semua rute setelah ini membutuhkan login.
app.use((req, res, next) => {
  if (req.session.google?.spreadsheetId) { req.ctx = googleCtx(req); return next(); }
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, message: 'Silakan masuk dengan akun Google.', login: true });
  res.redirect('/masuk');
});

// Pembungkus halaman: error teknis ke log, pengguna melihat pesan sederhana.
const page = (fn) => async (req, res) => {
  try {
    res.locals.kategoriMap = await getKategori(req.ctx);
    await fn(req, res);
  } catch (err) {
    if (!(err instanceof UserError)) console.error(`[KERJAIN] GET ${req.originalUrl}`, err);
    if (isAuthError(err)) return req.session.destroy(() => res.redirect('/masuk'));
    const notFound = err instanceof UserError && err.status === 404;
    res.status(notFound ? 404 : 500).render('masuk', {
      title: notFound ? 'Tidak ditemukan' : 'Terjadi kendala',
      pesan: notFound ? 'Data yang Anda cari tidak ditemukan.' : 'Data belum berhasil dimuat. Silakan coba kembali beberapa saat lagi.',
      error: true,
    });
  }
};
const api = (fn, message) => async (req, res) => {
  try { await fn(req, res); } catch (err) { fail(req, res, err, message); }
};

// ─── Halaman ─────────────────────────────────────────────────────────────────

app.get('/', page(async (req, res) => {
  const all = await getPekerjaan(req.ctx);
  const t = today();
  const bulanIni = all.filter((p) => p.tanggal.startsWith(t.slice(0, 7)));
  const hariIni = all.filter((p) => p.tanggal === t).sort((a, b) => (a.waktu_mulai || '99').localeCompare(b.waktu_mulai || '99'));
  const bantuan = countBy(bulanIni.filter((p) => p.kategori === 'Bantuan Pegawai' || p.pegawai), (p) => p.subkategori || p.kategori).slice(0, 5);
  const berjalan = all.filter((p) => p.status === 'Berjalan' && p.tanggal !== t).slice(0, 5);
  const settings = await getSettings(req.ctx);
  res.render('dashboard', {
    namaSapaan: (settings.nama_pengguna || req.session.google.name || '').split(' ')[0],
    berjalanList: berjalan, totalBerjalan: all.filter((p) => p.status === 'Berjalan').length,
    title: 'Beranda',
    stat: {
      total: bulanIni.length,
      selesai: bulanIni.filter((p) => p.status === 'Selesai').length,
      berjalan: bulanIni.filter((p) => p.status === 'Berjalan').length,
      evidence: bulanIni.filter((p) => p.evidence > 0).length,
    },
    hariIniList: hariIni, bantuan, kosong: all.length === 0,
    namaBulan: `${BULAN[Number(t.slice(5, 7)) - 1]} ${t.slice(0, 4)}`,
  });
}));

function listQuery(q) {
  return {
    q: clean(q.q, 100), kategori: clean(q.kategori, 60), status: clean(q.status, 20),
    tanggal: isDate(q.tanggal) ? q.tanggal : '', evidence: q.evidence === '1' ? '1' : '',
    bulan: /^(0?[1-9]|1[0-2])$/.test(q.bulan || '') ? Number(q.bulan) : '',
    tahun: /^\d{4}$/.test(q.tahun || '') ? q.tahun : '',
  };
}

// Daftar pekerjaan. `partial=1` mengembalikan potongan HTML untuk pencarian/muat lagi.
app.get('/pekerjaan', page(async (req, res) => {
  const f = listQuery(req.query);
  const pageNo = Math.max(1, Number(req.query.page) || 1);
  const hasil = filterPekerjaan(await getPekerjaan(req.ctx), f);
  const items = hasil.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
  const data = { title: f.evidence ? 'Evidence' : 'Pekerjaan', mode: 'list', f, items, total: hasil.length, pageNo, more: hasil.length > pageNo * PAGE_SIZE, partial: req.query.partial === '1' };
  res.render('pekerjaan', data);
}));

async function formData(ctx) {
  const [pegawai, all] = await Promise.all([readSheet(ctx, 'pegawai'), getPekerjaan(ctx)]);
  const masalahList = [...new Set(all.map((p) => p.masalah.split('\n')[0]).filter(Boolean))].slice(0, 200);
  return { pegawaiList: pegawai.map((p) => p.nama), masalahList };
}

app.get('/pekerjaan/baru', page(async (req, res) => {
  const now = nowParts();
  let p = { tanggal: isDate(req.query.tanggal) ? req.query.tanggal : now.date, waktu_mulai: now.time, status: 'Selesai', kategori: Object.keys(res.locals.kategoriMap)[0] };
  if (req.query.template) {
    // Gunakan sebagai template: salin identitas pekerjaan, tanggal & hasil diisi ulang.
    const src = (await getPekerjaan(req.ctx)).find((x) => x.id === req.query.template);
    if (src) p = { ...p, kategori: src.kategori, subkategori: src.subkategori, judul: src.judul, uraian: src.uraian, jenis: src.jenis, pegawai: '' };
  }
  res.render('pekerjaan', { title: 'Catat Pekerjaan', mode: 'form', p, ...(await formData(req.ctx)) });
}));

app.get('/pekerjaan/rutin', page(async (req, res) => {
  res.render('pekerjaan', { title: 'Pekerjaan Rutin', mode: 'rutin', rutin: await readSheet(req.ctx, 'rutin') });
}));

app.get('/pekerjaan/:id', page(async (req, res) => {
  const p = (await getPekerjaan(req.ctx)).find((x) => x.id === req.params.id);
  if (!p) throw new UserError('Tidak ditemukan', 404);
  res.render('pekerjaan', { title: p.judul, mode: 'detail', p, maxMb: MAX_FILE_MB });
}));

app.get('/pekerjaan/:id/edit', page(async (req, res) => {
  const p = (await getPekerjaan(req.ctx)).find((x) => x.id === req.params.id);
  if (!p) throw new UserError('Tidak ditemukan', 404);
  res.render('pekerjaan', { title: 'Edit Pekerjaan', mode: 'form', p, ...(await formData(req.ctx)) });
}));

app.get('/kalender', page(async (req, res) => res.render('kalender', { title: 'Kalender' })));

app.get('/laporan', page(async (req, res) => {
  const t = today();
  const f = listQuery({ ...req.query, bulan: req.query.bulan || t.slice(5, 7), tahun: req.query.tahun || t.slice(0, 4) });
  const settings = await getSettings(req.ctx);
  const items = filterPekerjaan(await getPekerjaan(req.ctx), f)
    .sort((a, b) => (a.tanggal + a.waktu_mulai).localeCompare(b.tanggal + b.waktu_mulai));
  res.render('laporan', {
    title: 'Laporan', f, items, settings,
    periode: `${BULAN[f.bulan - 1]} ${f.tahun}`,
    perKategori: countBy(items, (p) => p.kategori),
    perJenis: countBy(items, jenisOf),
    masalah: masalahTerbanyak(items),
    bantuan: countBy(items.filter((p) => p.kategori === 'Bantuan Pegawai' || p.pegawai), (p) => p.subkategori || p.kategori).slice(0, 8),
    selesai: items.filter((p) => p.status === 'Selesai').length,
    tahunList: [...new Set([Number(t.slice(0, 4)), Number(settings.tahun) || 0, Number(f.tahun)].filter(Boolean))].sort().reverse()
      .concat([Number(t.slice(0, 4)) - 1, Number(t.slice(0, 4)) - 2]).filter((v, i, a) => a.indexOf(v) === i),
    dicetak: tglPanjang(t),
  });
}));

app.get('/knowledge', page(async (req, res) => {
  const rows = await readSheet(req.ctx, 'knowledge');
  const q = clean(req.query.q, 100);
  const terms = normal(q).split(' ').filter(Boolean);
  const list = rows.filter((k) => { const hay = normal(Object.values(k).join(' ')); return terms.every((t) => hay.includes(t)); });
  const kelompok = {};
  for (const k of list.sort((a, b) => a.judul.localeCompare(b.judul))) (kelompok[k.kelompok || 'Lainnya'] ||= []).push(k);
  let draft = null;
  if (req.query.dari) {
    // Prefill artikel dari pekerjaan yang sudah dicatat.
    const p = (await getPekerjaan(req.ctx)).find((x) => x.id === req.query.dari);
    if (p) draft = { kelompok: p.subkategori || p.kategori, judul: p.masalah.split('\n')[0] || p.judul, masalah: p.masalah, solusi: p.tindakan, evidence_url: p.drive_folder_url };
  }
  res.render('knowledge', { title: 'Knowledge Base', kelompok, q, total: rows.length, draft, safeUrl });
}));

app.get('/pengaturan', page(async (req, res) => {
  res.render('pengaturan', {
    title: 'Pengaturan', settings: await getSettings(req.ctx), fields: SETTING_FIELDS,
    rutin: await readSheet(req.ctx, 'rutin'),
    google: { email: req.session.google.email, sheetUrl: `https://docs.google.com/spreadsheets/d/${req.ctx.sid}`, folderUrl: req.ctx.g.folderId ? `https://drive.google.com/drive/folders/${req.ctx.g.folderId}` : '' },
  });
}));

// ─── API ─────────────────────────────────────────────────────────────────────

app.post('/api/pekerjaan', api(async (req, res) => {
  const data = parsePekerjaan(req.body, await getKategori(req.ctx));
  const [p] = await createPekerjaan(req.ctx, [data]);
  rememberPegawai(req.ctx, data.pegawai).catch((e) => console.error('[KERJAIN] simpan pegawai', e));
  res.json({ ok: true, id: p.id, message: 'Pekerjaan berhasil disimpan.' });
}));

app.put('/api/pekerjaan/:id', api(async (req, res) => {
  const old = await findFresh(req.ctx, 'pekerjaan', req.params.id);
  const data = parsePekerjaan(req.body, await getKategori(req.ctx), old);
  await updateRow(req.ctx, 'pekerjaan', req.params.id, data);
  rememberPegawai(req.ctx, data.pegawai).catch((e) => console.error('[KERJAIN] simpan pegawai', e));
  res.json({ ok: true, id: req.params.id, message: 'Data berhasil diperbarui.' });
}));

app.patch('/api/pekerjaan/:id/selesai', api(async (req, res) => {
  const waktu = clean(req.body.waktu_selesai, 5);
  if (waktu && !isTime(waktu)) throw new UserError('Format waktu selesai tidak valid.');
  await updateRow(req.ctx, 'pekerjaan', req.params.id, { status: 'Selesai', hasil: clean(req.body.hasil, 1000), waktu_selesai: waktu });
  res.json({ ok: true, message: 'Pekerjaan ditandai selesai.' });
}));

app.delete('/api/pekerjaan/:id', api(async (req, res) => {
  await deleteRow(req.ctx, 'pekerjaan', req.params.id);
  res.json({ ok: true, message: 'Data berhasil dihapus.' });
}, 'Data belum berhasil dihapus. Silakan coba kembali.'));

// Catat beberapa pekerjaan rutin sekaligus.
app.post('/api/rutin/catat', api(async (req, res) => {
  const ids = [].concat(req.body.ids || []).map(String);
  const now = nowParts();
  const tanggal = isDate(req.body.tanggal) ? req.body.tanggal : now.date;
  const waktu = isTime(req.body.waktu) ? req.body.waktu : now.time;
  const rutin = (await readSheet(req.ctx, 'rutin')).filter((r) => ids.includes(r.id));
  if (!rutin.length) throw new UserError('Pilih minimal satu pekerjaan rutin.');
  const kategoriMap = await getKategori(req.ctx);
  const items = rutin.map((r) => ({
    tanggal, waktu_mulai: waktu, kategori: kategoriMap[r.kategori] ? r.kategori : Object.keys(kategoriMap)[0],
    subkategori: r.subkategori, judul: r.judul, status: 'Selesai', jenis: /monitor/i.test(r.judul) ? 'Monitoring' : 'Pemeliharaan',
  }));
  const created = await createPekerjaan(req.ctx, items);
  res.json({ ok: true, message: `${created.length} pekerjaan rutin berhasil dicatat.` });
}));

app.post('/api/rutin', api(async (req, res) => {
  const judul = clean(req.body.judul, 200);
  if (!judul) throw new UserError('Nama pekerjaan rutin wajib diisi.');
  const kategoriMap = await getKategori(req.ctx);
  const kategori = kategoriMap[req.body.kategori] ? req.body.kategori : 'IT / PTIP';
  await withLock(req.ctx, async () => {
    const rows = await readSheet(req.ctx, 'rutin', { fresh: true });
    const seq = rows.reduce((m, r) => Math.max(m, Number(r.id.replace('RTN-', '')) || 0), 0) + 1;
    await appendRows(req.ctx, 'rutin', [{ id: `RTN-${String(seq).padStart(3, '0')}`, judul, kategori, subkategori: clean(req.body.subkategori, 60), created_at: nowParts().stamp }]);
  });
  res.json({ ok: true, message: 'Pekerjaan rutin berhasil ditambahkan.' });
}));

app.delete('/api/rutin/:id', api(async (req, res) => {
  await deleteRow(req.ctx, 'rutin', req.params.id);
  res.json({ ok: true, message: 'Data berhasil dihapus.' });
}, 'Data belum berhasil dihapus. Silakan coba kembali.'));

// Upload evidence: folder dibuat otomatis saat file pertama diunggah.
app.post('/api/pekerjaan/:id/evidence', (req, res) => {
  upload(req, res, async (err) => {
    try {
      if (err instanceof multer.MulterError) {
        throw new UserError(err.code === 'LIMIT_FILE_SIZE' ? `Ukuran file maksimal ${MAX_FILE_MB} MB.` : err.code === 'LIMIT_FILE_COUNT' ? 'Maksimal 10 file sekali upload.' : 'File tidak valid.');
      }
      if (err) throw err;
      if (!req.files?.length) throw new UserError('Pilih file evidence terlebih dahulu.');
      let p = await findFresh(req.ctx, 'pekerjaan', req.params.id);
      p = await ensureEvidenceFolder(req.ctx, p);
      for (const file of req.files) {
        await req.ctx.drive.files.create({
          requestBody: { name: safeFileName(file.originalname), parents: [p.drive_folder_id] },
          media: { mimeType: file.mimetype, body: Readable.from(file.buffer) },
          fields: 'id',
        });
      }
      await updateRow(req.ctx, 'pekerjaan', p.id, { jumlah_evidence: String((Number(p.jumlah_evidence) || 0) + req.files.length) });
      res.json({ ok: true, url: p.drive_folder_url, message: 'Evidence berhasil disimpan.' });
    } catch (e) {
      fail(req, res, e, 'Evidence belum berhasil disimpan. Silakan coba kembali.');
    }
  });
});

app.get('/api/pekerjaan/:id/evidence', api(async (req, res) => {
  const p = (await getPekerjaan(req.ctx)).find((x) => x.id === req.params.id);
  if (!p) throw new UserError('Data tidak ditemukan.', 404);
  if (!p.drive_folder_id) return res.json({ ok: true, files: [] });
  const list = await req.ctx.drive.files.list({
    q: `'${p.drive_folder_id}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,webViewLink,size,createdTime)', pageSize: 50, orderBy: 'createdTime',
  });
  res.json({ ok: true, url: p.drive_folder_url, files: list.data.files.map((f) => ({ name: f.name, url: f.webViewLink, image: f.mimeType.startsWith('image/'), mime: f.mimeType, size: Number(f.size) || 0, created: f.createdTime || '' })) });
}, 'Daftar evidence belum berhasil dimuat.'));

// Event kalender: diringkas per tanggal per kategori.
app.get('/api/kalender', api(async (req, res) => {
  const start = String(req.query.start || '').slice(0, 10);
  const end = String(req.query.end || '').slice(0, 10);
  const all = await getPekerjaan(req.ctx);
  const map = new Map();
  for (const p of all) {
    if ((start && p.tanggal < start) || (end && p.tanggal >= end)) continue;
    const key = `${p.tanggal}|${p.kategori}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  res.json([...map.entries()].map(([key, n]) => {
    const [tanggal, kategori] = key.split('|');
    return { title: `${KATEGORI_PENDEK[kategori] || kategori}${n > 1 ? ` ${n}` : ''}`, start: tanggal, allDay: true, extendedProps: { kategori, n } };
  }));
}, 'Kalender belum berhasil dimuat.'));

app.get('/api/hari/:tanggal', api(async (req, res) => {
  if (!isDate(req.params.tanggal)) throw new UserError('Tanggal tidak valid.');
  const items = (await getPekerjaan(req.ctx)).filter((p) => p.tanggal === req.params.tanggal)
    .sort((a, b) => (a.waktu_mulai || '99').localeCompare(b.waktu_mulai || '99'));
  res.json({ ok: true, label: tglPanjang(req.params.tanggal), items: items.map((p) => ({ id: p.id, judul: p.judul, waktu: p.waktu_mulai, kategori: p.kategori, status: p.status })) });
}, 'Data belum berhasil dimuat.'));

function parseKnowledge(body) {
  const data = {
    kelompok: clean(body.kelompok, 60) || 'Lainnya',
    judul: clean(body.judul, 200),
    masalah: clean(body.masalah, 2000),
    penyebab: clean(body.penyebab, 2000),
    solusi: clean(body.solusi, 4000),
    evidence_url: safeUrl(clean(body.evidence_url, 500)),
  };
  if (!data.judul) throw new UserError('Judul artikel wajib diisi.');
  return data;
}

app.post('/api/knowledge', api(async (req, res) => {
  const data = parseKnowledge(req.body);
  await withLock(req.ctx, async () => {
    const rows = await readSheet(req.ctx, 'knowledge', { fresh: true });
    const seq = rows.reduce((m, r) => Math.max(m, Number(r.id.replace('KB-', '')) || 0), 0) + 1;
    const stamp = nowParts().stamp;
    await appendRows(req.ctx, 'knowledge', [{ ...data, id: `KB-${String(seq).padStart(3, '0')}`, created_at: stamp, updated_at: stamp }]);
  });
  res.json({ ok: true, message: 'Artikel berhasil disimpan.' });
}));

app.put('/api/knowledge/:id', api(async (req, res) => {
  await updateRow(req.ctx, 'knowledge', req.params.id, parseKnowledge(req.body));
  res.json({ ok: true, message: 'Data berhasil diperbarui.' });
}));

app.delete('/api/knowledge/:id', api(async (req, res) => {
  await deleteRow(req.ctx, 'knowledge', req.params.id);
  res.json({ ok: true, message: 'Data berhasil dihapus.' });
}, 'Data belum berhasil dihapus. Silakan coba kembali.'));

app.post('/api/pengaturan', api(async (req, res) => {
  const values = SETTING_FIELDS.map(([key]) => [key, clean(req.body[key], 150)]);
  const tahun = values.find(([k]) => k === 'tahun')[1];
  if (tahun && !/^\d{4}$/.test(tahun)) throw new UserError('Tahun harus 4 digit angka.');
  await withLock(req.ctx, async () => {
    await req.ctx.sheets.spreadsheets.values.clear({ spreadsheetId: req.ctx.sid, range: 'pengaturan!A2:B' });
    await req.ctx.sheets.spreadsheets.values.update({
      spreadsheetId: req.ctx.sid, range: `pengaturan!A2:B${values.length + 1}`, valueInputOption: 'RAW', requestBody: { values },
    });
    invalidate(req.ctx, 'pengaturan');
  });
  res.json({ ok: true, message: 'Data berhasil diperbarui.' });
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, message: 'Tidak ditemukan.' });
  res.status(404).render('masuk', { title: 'Tidak ditemukan', pesan: 'Halaman yang Anda cari tidak ditemukan.', error: true });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(`[KERJAIN] ${req.method} ${req.originalUrl}`, err);
  viewLocals(req, res);
  if (req.path.startsWith('/api/')) return res.status(err.status || 500).json({ ok: false, message: 'Permintaan belum berhasil diproses.' });
  res.status(500).render('masuk', { title: 'Terjadi kendala', pesan: 'Terjadi kendala. Silakan coba kembali.', error: true });
});

app.listen(PORT, () => console.log(`KERJAIN berjalan di http://localhost:${PORT}`));
