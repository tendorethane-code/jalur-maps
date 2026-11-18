# Jalur

**Buka app-nya:** https://tendorethane-code.github.io/jalur-maps/
(di HP: buka di Chrome → menu ⋮ → *Tambahkan ke layar utama*)

Pemilih rute motor buat Jabodetabek. Masalah yang mau diberesin: Google Maps suka
nyeret motor ke jalan tikus, dan kita baru sadar pas udah jalan.

Jalur nunjukin **2–4 pilihan rute sebelum berangkat**, masing-masing dengan:

- porsi **jalan gede / sedang / kecil (gang)**, juga digambar dengan warna di peta,
- jalan utama yang dilewatin ("Lewat Jl. Tebet Raya → Jl. Supomo → …"),
- jumlah belokan, ruas gang, putar balik,
- plus-minus dibanding rute lain,
- **"Hati-hati di sini"**: percabangan yang rawan salah ambil (ambil kiri/kanan, flyover,
  underpass, putar balik). Ketuk satu, peta nge-zoom ke titik itu dengan panah arah,
  lalu geser ke titik berikutnya. Gunanya biar lu tahu jalurnya *sebelum* jalan, bukan
  ngezoom HP sambil nyetir.

Rute yang dipilih dibuka di **Google Maps** dengan 3 titik singgah, jadi navigasi dan
data macetnya tetap dari Google. Kalau titik awalnya "Lokasi kamu", link-nya gak bawa
titik awal, jadi Google pakai GPS live dan tinggal tekan **Mulai**.

Peta dan pencarian tempat pakai **Google** (sama kayak di Google Maps). Kalau Google lagi
gak bisa (kuota habis, error), Jalur otomatis pindah ke peta cadangan OpenStreetMap.

Pencarian cadangan (OpenStreetMap): ketik nama tempat atau jalan. Singkatan kayak "Jl.", "Gg." dan nomor rumah
dirapihin dulu, dan hasil yang paling deket sama lu ditaruh paling atas (ada jaraknya).
Kalau gak ketemu, ada tombol **Cari lebih teliti** (lebih bagus buat alamat lengkap). Bisa juga
paste koordinat atau link Google Maps yang ada koordinatnya. Paling ampuh: di Google Maps
tekan **Bagikan → Jalur** (Android, app udah dipasang), tujuannya langsung keisi.

Tampilan: kartu rute bisa di-swipe, tiap rute ada gelembung waktu di peta, warna jalan
(biru gede, hijau sedang, oranye kecil) konsisten di peta, bar, dan daftar jalan.
Sheet bawah bisa ditarik (kecil / setengah / penuh). Mode gelap ikut setelan HP.

## Cara jalanin

```bash
npm test      # logika rute, pakai respons asli Valhalla yang direkam (test/fixtures)
npm run dev   # http://localhost:5173 (GPS jalan di localhost; di HP butuh https)
```

Gak ada dependency dan gak ada build step. `public/` langsung bisa di-host sebagai
file statis. Workflow `.github/workflows/pages.yml` nge-deploy folder itu ke
GitHub Pages tiap ada perubahan di `main`.

## Cara kerja

| Bagian | Sumber | Catatan |
| --- | --- | --- |
| Peta | Google Maps (cadangan: tile OpenStreetMap) | Kunci browser di `public/config.js`, dibatasi ke situs ini. |
| Rute | [Valhalla](https://valhalla1.openstreetmap.de) (server publik FOSSGIS), profil `motorcycle` | Gratis, tanpa key, **tanpa data macet**. |
| Jenis jalan | `trace_attributes` Valhalla per ruas | primary/secondary/trunk = gede, tertiary = sedang, sisanya + living street/alley = kecil. |
| Cari tempat | Google Places (cadangan: [Photon](https://photon.komoot.io) + Nominatim) | Yang deket muncul duluan. |

Kandidat rute (`public/lib/api.js`):
1. rute motor standar + 2 alternatif,
2. rute motor terpendek,
3. rute "jalan kecil": dicari pakai profil sepeda, lalu dicek ulang sebagai rute motor.
   Kalau ada jalur khusus sepeda atau lawan arah, rute ini dibuang (server balikin 400, itu normal).

Rute yang ≥85% lewat jalan yang sama digabung. Sisanya dikasih label
`Tercepat* / Terpendek / Jalan gede / Banyak gang` (`public/lib/route-analysis.js`).

## Keterbatasan (jujur aja)

- **Estimasi waktu belum ngitung macet.** Waktu asli lihat di Google Maps setelah dibuka.
- **Klasifikasi jalan dari OSM bisa salah.** Gang yang di-tag `residential` sama kayak jalan
  perumahan biasa. Perlu dicek di rute yang beneran sering dilewatin.
- **Google Maps bisa tetap "pinter sendiri"** di antara titik singgah, dan titik singgah
  muncul sebagai "perhentian". Belum dites di HP.
- `travelmode=two-wheeler` di link Google Maps belum dicek di semua versi aplikasi.
- Server publik Valhalla/Photon dijalanin relawan. Satu pencarian = sekitar 6–10 request.
  Jangan dipakai buat banyak orang tanpa server sendiri.

## Asal-usul

Awalnya dibikin di repo `making-something` (folder `projects/jalur`), lalu dipindah ke
repo public ini supaya bisa di-host gratis di GitHub Pages.
