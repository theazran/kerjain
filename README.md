# KERJAIN

**Catat. Kerjakan. Buktikan.**

Aplikasi pencatatan pekerjaan harian. Data disimpan di Google Spreadsheet, evidence di Google Drive.

## Menjalankan

```bash
npm install
cp .env.example .env   # lalu isi nilainya
npm start              # membangun CSS lalu menjalankan server di http://localhost:3000
```

Mode pengembangan (restart otomatis): `npm run dev`. Setelah mengubah kelas Tailwind di view, jalankan `npm run build:css`.

## Menyiapkan Google OAuth

1. Buka Google Cloud Console → buat project.
2. Aktifkan **Google Sheets API** dan **Google Drive API**.
3. OAuth consent screen → tipe *External* (atau *Internal* untuk Workspace), tambahkan akun Anda sebagai *test user*.
   Scope yang dipakai: `openid`, `email`, `profile`, `spreadsheets`, `drive.file`.
4. Credentials → *Create OAuth client ID* → **Web application**.
   Authorized redirect URI: `http://localhost:3000/auth/callback` (sesuaikan untuk server produksi).
5. Salin Client ID & Secret ke `.env`.

Biarkan `GOOGLE_SPREADSHEET_ID` dan `GOOGLE_DRIVE_FOLDER_ID` kosong: saat login pertama, KERJAIN membuat
spreadsheet **KERJAIN Database** (sheet `pekerjaan`, `pegawai`, `kategori`, `pengaturan`, `rutin`, `knowledge`)
dan folder **KERJAIN** di Drive akun tersebut. Jika diisi ID milik sendiri, file itu harus bisa diakses akun yang login
(folder buatan manual mungkin tidak terlihat oleh scope `drive.file`, jadi sebaiknya dibiarkan kosong).

Struktur evidence: `KERJAIN / 2026 / 10 Oktober / LOG-2026-10-04-001 - Judul`. Folder dibuat otomatis saat evidence pertama diupload.

## Struktur

```
app.js            server: rute, Google Sheets/Drive, validasi
views/            layout + halaman (dashboard, pekerjaan, kalender, laporan, knowledge, pengaturan, masuk)
public/style.css  sumber Tailwind + gaya tambahan  →  public/app.css (hasil build)
public/app.js     interaksi frontend (quick log, upload, pencarian, kalender, grafik)
```

## Catatan

- Sesi login disimpan di file `.sessions` (terenkripsi dengan `SESSION_SECRET`), sehingga tetap aktif setelah server restart.
  Sesi berlaku 30 hari sejak pemakaian terakhir. Mengganti `SESSION_SECRET` akan mengeluarkan semua pengguna.
- Selama OAuth consent screen berstatus *Testing*, Google membatalkan izin setelah 7 hari, jadi pengguna perlu login ulang setiap minggu.
  Ubah status ke *In production* agar sesi bertahan penuh.
- `ALLOWED_EMAILS` membatasi akun yang boleh masuk. Isi untuk server yang dapat diakses publik.
- Produksi: set `NODE_ENV=production` dan jalankan di belakang HTTPS (cookie sesi `secure`).
- Export PDF memakai dialog cetak browser → pilih "Simpan sebagai PDF".
- Kategori/subkategori dapat ditambah langsung di sheet `kategori`.

## Pasang di iPhone (PWA)

1. Jalankan KERJAIN di alamat **HTTPS** (domain sendiri, atau tunnel seperti Cloudflare Tunnel/ngrok untuk uji coba),
   lalu daftarkan `https://domain-anda/auth/callback` sebagai redirect URI di Google Cloud dan di `.env`.
2. Buka alamat tersebut di **Safari** → tombol Bagikan → **Tambahkan ke Layar Utama**.
3. Buka KERJAIN dari ikon di layar utama, lalu masuk dengan Google sekali.

Dashboard menampilkan ajakan **Pasang KERJAIN** (juga di Pengaturan → Aplikasi). Di Android/Chrome tombolnya membuka prompt pemasangan bawaan; di iPhone/iPad menampilkan panduan langkah demi langkah.

`/?catat=1` membuka form catat cepat secara langsung (bisa dipakai di aplikasi Pintasan/Shortcuts iPhone).
