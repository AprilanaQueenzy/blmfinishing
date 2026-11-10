# PANGAN PAS

Prototype dashboard untuk melihat simulasi perubahan harga pangan antarprovinsi di Indonesia. Peta memakai MapLibre dengan data batas provinsi lokal; harga dan tren yang tampil merupakan data simulasi.

## Menjalankan lokal

```bash
npm install
```

Salin `.env.example` menjadi `.env.local`, lalu isi `NVIDIA_API_KEY` untuk mengaktifkan asisten AI. Jangan commit `.env.local` atau membagikan API key di repository publik.

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Stack

- React dan Vite
- MapLibre GL JS dengan OpenFreeMap
- Recharts
- NVIDIA chat completions API untuk asisten pangan

## Deploy ke Vercel

Folder ini sudah dikonfigurasi untuk Vercel sebagai aplikasi Vite SPA. Hubungkan repository/folder ke Vercel atau jalankan `npx vercel` dari folder proyek. Untuk production gunakan `npx vercel --prod`.

Build command: `npm run build`  
Output directory: `dist`

Agar Asisten Pangan aktif setelah deploy, tambahkan environment variable `NVIDIA_API_KEY` di Vercel Project Settings → Environment Variables. Jangan masukkan key ke file frontend atau commit `.env.local`. Endpoint AI berada di `api/ai.js` dan meneruskan jawaban secara streaming.

## Data harga riil (PIHPS Bank Indonesia)

Harga diambil dari **PIHPS Nasional – Bank Indonesia** (https://www.bi.go.id/hargapangan) lewat fungsi server `api/harga.js`
(`/api/harga?jenis=tradisional|modern&rentang=7d|14d|30d|3m|6m|12m`). Jenis tempat: *Pasar Tradisional* dan *Pasar Modern*
(ditampilkan sebagai Supermarket). Periode 7–30 hari memakai laporan harian, 3–6 bulan mingguan, 12 bulan bulanan.
Nilai adalah rata-rata pasar pantauan PIHPS per provinsi. Jagung pipilan dan provinsi baru Papua (Papua Tengah, Papua
Pegunungan, Papua Selatan, Papua Barat Daya) tidak dipantau PIHPS, jadi tampil "Data belum tersedia".
Respons di-cache 3 jam di CDN Vercel; permintaan pertama bisa memakan 10–25 detik karena menunggu situs PIHPS.

## Komunitas (MySQL + PHP)

Lihat `backend-php/README.md`. Isi `VITE_COMMUNITY_API_URL` agar Komunitas memakai database; tanpa itu Komunitas berjalan
dalam mode lokal di browser.


## Akun, notifikasi harga, dan pencarian di sekitar
- Halaman `/daftar`, `/masuk` (username/email + password), `/profil` (ubah nama/username/password, mode gelap,
  notifikasi harga, akses lokasi, lokasi favorit, pantauan harga, kotak notifikasi, keluar). Backend: `backend-php/` (lihat README-nya).
- `/sekitar`: harga riil per kota/kabupaten pantauan PIHPS (`/api/daerah`), radius 5/10/25/50 km, urut termurah/terdekat,
  atau pilih wilayah manual. PIHPS hanya menerbitkan rata-rata per kota (bukan per toko); untuk supermarket ditampilkan
  nama toko yang dipantau. Daftar kota + koordinat pusat kota: `api/_regencies.json` (dibuat oleh `node scripts/build-regencies.mjs`,
  koordinat © OpenStreetMap contributors).

## Asisten AI (NVIDIA)
- Isi `NVIDIA_API_KEY` di env server (Vercel atau `.env.local`). Model default `nvidia/nemotron-3.5-super-vl-120b-a12b`.
- Tombol **Tanya AI** ada di semua halaman (kecuali Peta, yang punya asisten sendiri). Asisten memakai data PIHPS riil sebagai
  konteks, bisa membaca foto label harga/struk, dan memberi tombol tautan ke fitur terkait.
- Halaman Tren: tombol **Jelaskan dengan AI**. Form Komunitas: **Isi otomatis dari foto (AI)**.
- Endpoint `/api/ai` (mode `fast`, `chat`, `extract`) menyimpan kunci di server, memvalidasi pesan/gambar, dan membatasi 20 permintaan/menit per IP.

## Akses tamu & login
- Tamu (belum login) mendapat **3 kali akses gratis** per fitur: 3 kunjungan Peta harga, 3 kunjungan Tren, dan 3 pencarian
  di Cari di sekitar. Setelah itu muncul layar "Akses gratis habis" dengan tombol Masuk / Daftar.
  Penghitung disimpan di browser (`pangan-pas-akses-tamu-v1`); ini pembatas kenyamanan, bukan keamanan (data PIHPS publik).
- Komunitas: tamu hanya bisa melihat. Kirim temuan, komentar, dan balasan wajib login; nama penulis diambil dari akun.
