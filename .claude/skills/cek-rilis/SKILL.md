---
name: cek-rilis
description: Cek kesiapan rilis sebelum push/merge/rilis/deploy - jalanin build, test, cek keamanan, upgrade, rencana mundur, lalu laporan GO / NO-GO dengan bukti berlabel. Pakai kalau user bilang cek rilis, siap rilis?, aman di-push?, atau /cek-rilis. Jangan push/tag/rilis/deploy sebelum user bilang GO.
---

# CEK RILIS
Catatan dari user (kalau ada): $ARGUMENTS
Proyek: repo ini. Versi: tentukan dari tag/versi terakhir. Jenis: deteksi sendiri, lalu pakai cuma bagian "Cek tambahan" yang relevan.
Kalau CLAUDE.md repo ini punya bagian "Cek rilis", itu konfigurasi khusus repo: ikutin, dan dia menang atas daftar umum di bawah.

Lu reviewer rilis yang skeptis. Tugas lu: buktiin perubahan ini aman dirilis, atau temuin kenapa belum. Targetnya bukan nol bug (itu mustahil), tapi: gak ada bug fatal, sisa risiko diketahui dan diterima secara sadar, dan kalau rusak kita cepat tau dan cepat benerin.

## Aturan
- Gak ada "lulus" tanpa bukti. Tiap status sebut buktinya: command + hasilnya, atau file:baris.
- Kasih label jenis bukti: [dijalanin] command/test/app beneran jalan · [kode] dibaca di source · [luar] dicek di HP/VM/layanan asli · [kata orang] dari user atau AI lain, belum lu cek · [dugaan] kesimpulan gak langsung. [kode], [kata orang], dan [dugaan] gak boleh dinaikin jadi "udah dites". Contoh: script uninstall gak punya perintah hapus data = fakta [kode]; data beneran aman setelah uninstall = butuh [luar].
- Yang gak bisa dicek di sini (HP asli, Windows, akun, kunci API): tandai ❓, kasih alasannya, dan tulis langkah buat gw ngecek sendiri. Jangan ditebak.
- Jangan skip, matiin, atau longgarin test biar hijau.
- Jangan push, tag, rilis, atau deploy sebelum gw bilang GO.
- Masalah kecil yang jelas (versi gak sinkron, cache lupa di-bump, typo) boleh langsung dibenerin, tapi laporin. Masalah besar: laporin dulu, jangan dirombak.
- Baca dulu README, CLAUDE.md/AGENTS.md, docs rilis, dan config CI. Aturan proyek menang atas daftar umum ini.

## Langkah
0. Kenali proyek: jenisnya, cara rilisnya, dan seberapa gampang dibalikin kalau rusak (web statis: menit; installer/APK: gak bisa ditarik, cuma bisa di-patch; migrasi data: bisa jadi gak bisa sama sekali).
1. Tingkat risiko. Jawab pakai alasan, bukan skor: (a) kalau rusak, separah apa dan siapa yang kena? Data yang gak bisa diganti = parah, walau user-nya cuma satu. (b) Bakal langsung ketahuan atau rusak diam-diam? (c) Bisa dibalikin secepat apa? (d) Seberapa besar perubahannya, nyentuh bagian rawan gak (data, migrasi, installer/updater, login, pembayaran)? Lalu tetapkan:
   - RENDAH: langkah di bawah cukup.
   - SEDANG: + alur utama wajib dicoba di lingkungan asli (HP/VM bersih) sebelum GO.
   - TINGGI: + backup dan restore/rollback dilatih beneran, dipakai sendiri dulu (atau rilis bertahap) sebelum disebar, review kedua sebelum GO, dan cek [luar] gak boleh ada yang ❓.
2. Scope: apa aja yang berubah sejak tag/rilis terakhir. Cari sisa kerjaan: TODO baru, kode debug, console.log/print nyasar, test yang di-skip atau .only, file sementara.
3. Build & test: install bersih, build, lint, typecheck, semua test, pakai command yang sama dengan CI. Cek status CI di remote kalau bisa.
4. Keamanan: secret/token/.env/data pribadi di diff; audit dependency (npm audit, pip-audit, dsb.); input user yang masuk ke HTML/SQL/shell/path file; izin atau endpoint jaringan baru.
5. Jalanin aplikasinya beneran: alur utama dari awal sampai akhir, plus kasus jelek (input kosong, internet mati/lambat, data aneh). Test hijau belum tentu aplikasinya jalan.
6. Upgrade & data: user yang masih pakai versi lama gimana? Setting/data/cache lama masih kebaca? Migrasi aman dan ada backup? Nomor versi sinkron di semua file?
7. Cek tambahan sesuai jenis (di bawah).
8. Rencana mundur: kalau rusak setelah rilis, caranya apa (revert, rollback, patch), berapa lama, dan apa yang GAK bisa dibalikin.
9. Setelah rilis: gimana kita bakal tau kalau rusak (telemetry/log kalau ada; kalau gak ada: laporan error dari app, issue, laporan user) dan apa yang dicek pertama kali di produksi. Lama pantaunya sesuai jenis app, bukan angka tetap.
10. Dokumen: changelog/catatan rilis, README, dan docs proyek ikut diperbarui.

## Cek tambahan
Web / PWA:
- Lebar HP 320–390 px dan desktop, dark mode, gak ada scroll ke samping, gak ada error di console
- Cache: service worker/CDN di-bump, user lama dapat file baru
- Key & kuota API pihak ketiga: domain dibatasi, kuota cukup
- Link, redirect, dan halaman 404
Desktop:
- Install di mesin bersih (bukan mesin developer)
- Upgrade di atas versi lama: setting & data kebawa
- Uninstall bersih, gak ninggalin sampah
- Updater jalan, termasuk update ke versi BERIKUTNYA
- Signing, SmartScreen, false positive antivirus
- Path dengan spasi / huruf non-ASCII, akun non-admin
- Ganti nama/identitas app: AppId installer, folder data, uninstall gak ngehapus data user (dites di Windows, bukan cuma baca script)
- Checksum SHA-256 tiap file unduhan dicantumin di catatan rilis
Mobile:
- HP asli, bukan cuma emulator; versi OS lama yang masih didukung
- Izin (lokasi, notifikasi, storage), termasuk kalau ditolak
- Rotasi layar, app ke background lalu balik, internet putus
- Syarat review store, rilis bertahap (mis. 5% user dulu)
- App yang udah ter-install gak bisa ditarik: cek lebih ketat
- APK di luar store: checksum SHA-256 dicantumin
Backend / API / DB:
- Migrasi kompatibel sama versi lama (jangan hapus kolom yang masih dipakai)
- Backup ada dan restore pernah dicoba beneran
- API lama tetap jalan buat client lama
- Env/secret di server lengkap
- Beban & waktu respons di endpoint utama
Library / CLI:
- Semver: ada breaking change? versi naik sesuai
- Contoh di README masih jalan
- Versi runtime yang didukung (Node/Python/OS)
- Pesan error & exit code masuk akal
Game:
- Save lama masih bisa dibuka
- Performa (FPS, loading, memori) di spek minimum
- Main dari awal sampai akhir tanpa softlock; keyboard & controller
- Syarat sertifikasi platform/store

## Severity
- BLOCKER: data hilang/rusak, crash di alur utama, celah keamanan, gak bisa install/update/buka.
- MAJOR: fitur utama rusak tapi masih ada jalan lain.
- MINOR: sisanya.

## Format laporan (pakai persis ini)
### Keputusan: ✅ GO / ⚠️ GO dengan catatan / ❌ NO-GO
Satu-dua kalimat kenapa.
### Ringkasan
Proyek, jenis, versi, perubahan utama, tingkat risiko + alasannya.
### Hasil cek
| # | Cek | Status | Bukti [label] |
Status: ✅ lulus · ❌ gagal · ⚠️ risiko · ❓ belum bisa dicek · ➖ gak relevan
### Masalah (paling parah dulu)
- [BLOCKER/MAJOR/MINOR] apa, di mana, akibatnya, saran fix
### Yang udah lu benerin
### Yang harus gw cek sendiri (langkah konkret)
### Risiko yang diterima kalau tetap rilis
### Rencana mundur
### Langkah rilis (tunggu gw bilang GO)

Wajib NO-GO kalau: ada BLOCKER, ada test yang gagal, ada cek penting yang ❓ padahal sebenarnya bisa dicek di sini, atau risikonya TINGGI dan masih ada cek [luar] yang ❓.
