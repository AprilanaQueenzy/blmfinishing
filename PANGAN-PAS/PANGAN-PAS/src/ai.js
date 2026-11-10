// PANGAN PAS — AI client. All calls go to /api/ai (server holds the NVIDIA key).
// The assistant only gets real PIHPS figures as context and is told never to invent prices.
import { fetchPrices, statOf, unitOf, latestDate, NO_DATA, PERIODS } from './priceData.js';
import { getAccount, COMMODITY_NAMES, PROVINCE_NAMES } from './account.js';

/* ---------- streaming call ---------- */
// onDelta(textSoFar), onThinking(bool). Resolves with the final answer text.
export async function askAI({ messages, mode = 'chat', onDelta, onThinking, signal }) {
  const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, messages }), signal });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw Object.assign(new Error(body?.error || `Layanan AI bermasalah (HTTP ${res.status}).`), { notConfigured: Boolean(body?.notConfigured), status: res.status });
  }
  if (mode === 'extract') return (await res.json()).content || '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', thinking = false;
  const handle = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let packet; try { packet = JSON.parse(data); } catch { return; }
    const delta = packet.choices?.[0]?.delta || {};
    if (delta.reasoning_content && !text) { if (!thinking) { thinking = true; onThinking?.(true); } }
    if (typeof delta.content === 'string' && delta.content) {
      if (thinking) { thinking = false; onThinking?.(false); }
      text += delta.content;
      onDelta?.(stripThinkTags(text));
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(handle);
  }
  if (buffer) handle(buffer);
  if (thinking) onThinking?.(false);
  return stripThinkTags(text).trim();
}
// Some models inline their reasoning in <think>…</think>; never show it.
const stripThinkTags = t => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');

/* ---------- images ---------- */
// Downscales to fit the API's inline-image limit (≈ 300 KB data URL).
export async function imageToDataUrl(file, maxSide = 1280) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Pilih gambar JPG, PNG, atau WebP.');
  const bmp = await createImageBitmap(file);
  let side = maxSide;
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', i < 3 ? 0.82 : 0.7);
    if (url.length <= 380 * 1024) return url;
    side = Math.round(side * 0.75);
  }
  throw new Error('Gambar terlalu besar untuk dibaca. Coba foto yang lebih dekat.');
}

/* ---------- context from real data ---------- */
const PERIOD_FOR_CONTEXT = '30 hari';
const fmt = v => (v == null ? null : Math.round(v));
const pct = v => (v == null ? null : Math.round(v * 10) / 10);
const norm = s => s.toLocaleLowerCase('id-ID');
const mentioned = (list, q) => list.filter(n => norm(q).includes(norm(n)) || norm(q).includes(norm(n).replace(/^kep\. /, 'kepulauan ')));

// Builds a compact JSON context: national summary + whatever the question/page mentions.
export async function buildContext(question, page = {}) {
  const period = PERIODS.includes(page.periode) ? page.periode : PERIOD_FOR_CONTEXT;
  const out = { sumber: 'PIHPS Nasional – Bank Indonesia (rata-rata pasar pantauan per provinsi)', periode: period, catatan: 'Angka null = data belum tersedia.' };
  let trad = null, modern = null;
  try { [trad, modern] = await Promise.all([fetchPrices('tradisional', period), fetchPrices('modern', period).catch(() => null)]); }
  catch { out.galat_data = 'Data PIHPS tidak dapat dimuat saat ini.'; return out; }
  out.data_terakhir = latestDate(trad);
  out.nasional_pasar_tradisional = COMMODITY_NAMES.map(c => {
    const st = statOf(trad, c, 'Indonesia');
    return [c, fmt(st?.price), unitOf(trad, c), pct(st?.change)];
  });
  out.format_baris = '[komoditas, harga rupiah, satuan, perubahan % dalam periode]';

  const user = getAccount().user;
  const provinces = [...new Set([...mentioned(PROVINCE_NAMES, question), ...(page.wilayah && page.wilayah !== 'Indonesia' ? [page.wilayah] : []), ...(user?.favorit || []).slice(0, 3)])].slice(0, 4);
  const commodities = [...new Set([...mentioned(COMMODITY_NAMES, question), ...(page.komoditas && COMMODITY_NAMES.includes(page.komoditas) ? [page.komoditas] : [])])].slice(0, 3);

  if (provinces.length) {
    out.per_provinsi = Object.fromEntries(provinces.map(p => [p, COMMODITY_NAMES.map(c => { const st = statOf(trad, c, p); return [c, fmt(st?.price), pct(st?.change)]; })]));
  }
  for (const c of commodities) {
    const rows = PROVINCE_NAMES.map(p => [p, fmt(statOf(trad, c, p)?.price)]).filter(r => r[1] != null).sort((a, b) => a[1] - b[1]);
    out[`peringkat_${c}`] = { satuan: unitOf(trad, c), termurah: rows.slice(0, 5), termahal: rows.slice(-5).reverse(), jumlah_provinsi_berdata: rows.length };
    if (modern) {
      const m = statOf(modern, c, provinces[0] || 'Indonesia');
      const t = statOf(trad, c, provinces[0] || 'Indonesia');
      out[`pasar_vs_supermarket_${c}`] = { wilayah: provinces[0] || 'Indonesia', pasar_tradisional: fmt(t?.price), supermarket: fmt(m?.price) };
    }
  }
  if (user) out.pengguna = { nama: user.nama.split(' ')[0], lokasi_favorit: user.favorit, notifikasi_aktif: user.notifikasiHarga };
  return out;
}

export const APP_GUIDE = `Fitur PANGAN PAS (pakai tautan relatif ini bila relevan):
- /peta : peta harga per provinsi (pilih komoditas, periode 7 hari–12 bulan, pasar tradisional/supermarket). /peta?provinsi=NAMA membuka provinsi.
- /tren : grafik tren & perbandingan 2 provinsi, unduh CSV. /tren?komoditas=NAMA&wilayah=NAMA&periode=30%20hari
- /sekitar : cari harga pasar/supermarket di kota pantauan PIHPS terdekat (izin lokasi hanya saat diminta). /sekitar?komoditas=NAMA
- /komunitas : temuan harga dari warga (belum diverifikasi); /komunitas/tambah untuk mengirim, bisa isi otomatis dari foto label harga.
- /profil : akun, mode gelap, lokasi favorit, notifikasi & pantauan harga. /masuk dan /daftar untuk akun.`;

export const SYSTEM_PROMPT = `Kamu adalah "Asisten PANGAN PAS". Jawab dalam bahasa Indonesia yang ramah, jelas, dan ringkas (maksimal ±120 kata kecuali diminta rinci).
Aturan data:
- Gunakan HANYA angka pada KONTEKS. Jika angka tidak ada atau null, katakan "Data belum tersedia" — jangan menebak.
- Sebut sumber (PIHPS Bank Indonesia) dan tanggal data terakhir saat menyebut harga. Harga adalah rata-rata provinsi, bukan harga satu toko.
- Tulis harga seperti Rp14.250/kg. Bandingkan hanya komoditas dan satuan yang sama.
- Untuk gambar (label harga, struk, bahan pangan): jelaskan yang terbaca; bila ada harga, bandingkan dengan rata-rata pada konteks.
Gaya: boleh pakai **tebal** dan daftar "- " singkat. Di akhir jawaban, bila berguna, tambahkan maksimal 3 baris aksi dengan format persis:
AKSI: Label singkat | /tautan-relatif
${APP_GUIDE}`;

/* ---------- photo → community form ---------- */
export async function extractPriceFromImage(file) {
  const url = await imageToDataUrl(file);
  const prompt = `Baca foto label harga/struk/papan harga ini. Kembalikan HANYA JSON tanpa teks lain:
{"komoditas": salah satu dari ${JSON.stringify(COMMODITY_NAMES)} atau null, "harga": angka rupiah per satuan atau null, "satuan": "kg"|"liter"|"butir"|null, "nama_toko": teks atau null, "jenis_tempat": "Pasar tradisional"|"Supermarket"|null, "tanggal": "YYYY-MM-DD" atau null, "keyakinan": 0-1, "catatan": penjelasan singkat bahasa Indonesia}
Jika harga untuk kemasan (mis. 5 kg), hitung harga per satuan dan jelaskan di catatan.`;
  const raw = await askAI({ mode: 'extract', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }] });
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) throw new Error('AI tidak menemukan informasi harga pada foto.');
  let data; try { data = JSON.parse(json[0]); } catch { throw new Error('Hasil AI tidak dapat dibaca. Isi formulir secara manual.'); }
  return {
    commodity: COMMODITY_NAMES.includes(data.komoditas) ? data.komoditas : null,
    price: Number.isFinite(Number(data.harga)) && Number(data.harga) >= 100 ? Math.round(Number(data.harga)) : null,
    seller: ['Pasar tradisional', 'Supermarket'].includes(data.jenis_tempat) ? data.jenis_tempat : null,
    marketName: typeof data.nama_toko === 'string' ? data.nama_toko.slice(0, 80) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(data.tanggal || '') ? data.tanggal : null,
    confidence: Number(data.keyakinan) || 0,
    note: typeof data.catatan === 'string' ? data.catatan.slice(0, 240) : '',
  };
}

/* ---------- answer → safe pieces ---------- */
const SAFE_LINK = /^\/(peta|tren|sekitar|komunitas|profil|masuk|daftar)?(\/tambah)?(\?[A-Za-z0-9%=&._\-+ ]*)?$/;
const ACTION_LINE = /^\s*\**AKSI\**\s*:/i;
// While streaming, also hide a half-written trailing "AKS…" line.
const PARTIAL_ACTION = /\n\s*\**A(K(S(I)?)?)?\**\s*$/i;
export function splitActions(text, streaming = false) {
  const actions = [];
  const src = streaming ? text.replace(PARTIAL_ACTION, '') : text;
  const body = src.split('\n').filter(line => {
    if (!ACTION_LINE.test(line)) return true; // action lines are never shown as plain text
    const m = line.match(/^\s*\**AKSI\**\s*:\s*(.+?)\s*\|\s*(.+?)\s*$/i);
    const href = m ? m[2].replace(/^[`<(]+|[`>)]+$/g, '').trim() : '';
    if (m && SAFE_LINK.test(href) && actions.length < 3) actions.push({ label: m[1].replace(/\*/g, '').slice(0, 40), href: href.replace(/ /g, '%20') });
    return false;
  }).join('\n').trim();
  return { body, actions };
}
export { NO_DATA };
