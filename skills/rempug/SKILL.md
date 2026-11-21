---
name: rempug
description: Menyiapkan dan menjalankan delegasi kerja ke agent CLI lain (codex, agy, opencode, claude) yang berjalan di sesi tmux. Panggil /rempug sekali untuk mendeteksi dan menguji agent; sesudah itu delegasi, verifikasi, ulang, dan alih berjalan otomatis selama sesi tanpa user mengurusnya.
---

# rempug

Satu-satunya interaksi manusia dengan rempug adalah `/rempug`. Sesudahnya kamu (orkestrator) mendelegasikan, menunggu, memverifikasi, mengulang, dan mengalihkan pekerjaan sendiri. User tidak peduli komunikasi dengan agent; user hanya menilai apakah hasil yang ia minta sudah benar.

Perintah tersedia sebagai tool MCP `rempug` dengan nama yang sama (`send`, `show`, ...) atau lewat shell (`rempug send ...`). Pakai MCP bila ada. `watch` hanya lewat shell.

## `/rempug`: siapkan agent

1. Jalankan `status`. Bila barisnya menyebut agent `siap` dan tidak ada `baru`, `usang`, atau `tidak-andal`, laporkan satu baris dan lanjut ke "Mode otomatis".
2. Bila belum lengkap, jalankan `scan`. Ambil kandidat berkeyakinan `tinggi` atau `sedang` yang belum terdaftar. Jangan menanyakan pane berkeyakinan `rendah` kecuali tidak ada kandidat lain. Pane orkestrator sendiri sudah dikecualikan.
3. Ajukan **satu** pertanyaan, dengan nama saran dari jenis agent supaya user cukup menjawab "ya":
   > Saya menemukan codex di sesi 2 dan agy di sesi 1. Saya namai `codex` dan `agy`, kemampuan playwright. Sudah benar?
4. Untuk tiap agent jalankan `register` (probe berjalan otomatis; tanpa token darimu). Tampilkan hasilnya dengan `ls` sebagai tabel pendek.
5. `perlu-izin`: agent berhenti di prompt izin menjalankan `rempug`. Sebut sesi dan tindakannya (setujui `rempug` sekali, pilih izinkan selalu), lalu ulangi `probe <nama>` setelah user bilang sudah. **Jangan pernah menjawab prompt izin atas nama user.**
6. `tidak-andal` atau `tanpa-ack`: baca `layar <agent>` (cuplikan terbatas), usulkan satu profil lain, uji dengan `probe <nama> --profil '<json>'`. Hanya sekali. Bila tetap gagal, laporkan dan jangan pakai agent itu.
7. Pasang pemantau dengan tool Monitor: perintah `rempug watch`, `timeout_ms` maksimum, deskripsi "kejadian rempug". Kursor kejadian tersimpan, jadi pemasangan ulang menerima dulu yang terlewat. Tanpa Monitor, jalankan `rempug watch --bangun` di latar belakang.

## Mode otomatis

Berlaku sampai sesi berakhir. Putuskan sendiri, jangan bertanya.

| Pekerjaan                                                                        | Keputusan                           |
| -------------------------------------------------------------------------------- | ----------------------------------- |
| Observasi browser, membaca banyak file, audit read-only                          | Delegasikan (`baca` atau `browser`) |
| Perubahan mekanis dengan cakupan jelas dan CEK (`tsc`, `biome`, `vitest`)        | Delegasikan (`edit`)                |
| Beberapa pekerjaan independen                                                    | Paralel ke agent berbeda            |
| Desain, keputusan arsitektur, pekerjaan ambigu, atau tanpa cara verifikasi mesin | Kerjakan sendiri                    |
| Brief-nya sama panjang dengan mengerjakannya                                     | Kerjakan sendiri                    |

**Brief** wajib memuat bagian berlabel ini (rempug menolak yang kurang):

```
TUJUAN: satu kalimat
CAKUPAN: edit src/features/device/**, src/lib/x.ts   (atau: baca | browser)
LANGKAH:
1. langkah jelas, tanpa ruang tafsir
2. ...
CEK:
yarn tsc -b
yarn check
BALASAN: HASIL, BUKTI, BLOCKER
```

Pada tugas `baca` dan `browser`, `CEK` adalah deskripsi bukti yang harus dilaporkan agent (tidak dijalankan sebagai perintah); tulislah dengan kalimat biasa. Pada tugas `edit`, `CEK` adalah perintah shell yang dijalankan rempug.

Agent adalah model murah: tulis brief selengkap dan sejelas mungkin, karena biayanya kecil dibanding mengulang pekerjaan yang salah. Tugas `edit` wajib punya minimal satu CEK. Tambahkan `teliti` untuk tugas berisiko agar rencana agent selalu sampai padamu.

**Sebelum menunggu**, pastikan `watch` aktif. `send` memperingatkan bila tidak. Saat notifikasi kedaluwarsa Monitor datang dan masih ada tugas berjalan, pasang ulang segera.

### Menanggapi kejadian

| Kejadian                                 | Tindakan                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T12 codex ✓ ...`                        | Tinjau sesuai kebijakan di bawah                                                                                                                   |
| `✗` atau `gagal`                         | Tangga: kirim ulang dengan brief yang menyebut kegagalan spesifik (maks 2 kali, lihat `show <id> --penuh`), lalu agent lain, lalu kerjakan sendiri |
| `menunggu-klarifikasi`                   | Alasannya ada di baris kejadian; `jawab <id> "..."`. Butuh keputusan bisnis? tanya user                                                            |
| `bertanya`                               | Jawab dengan `jawab <id> "..."`                                                                                                                    |
| `menunggu-izin`                          | Manusia yang harus bertindak: satu kalimat berisi sesi dan tindakan, lalu lanjutkan pekerjaan lain                                                 |
| `limit`, `macet`, `tersangkut`, `hilang` | Alihkan ke agent lain atau kerjakan sendiri                                                                                                        |
| `pelanggaran` | Agent berpindah branch, menulis ulang riwayat, atau commit berkas di cakupan tugasnya sendiri: hentikan, laporkan ke user, jangan menumpuk tugas di atasnya |
| `ℹ HEAD maju N commit ... di luar cakupan tugas ini` | Bukan pelanggaran: commit user atau orkestrator saat tugas berjalan (beberapa agent berbagi satu working tree). Abaikan; hasil tugas tetap dinilai dari tes dan perubahannya |
| `diterima-tanpa-ack`                     | Agent menerima pointer tetapi tidak menjalankan rempug; alihkan                                                                                    |

### Kebijakan peninjauan

Jangan mempercayai klaim agent; baris verifikasi dihitung rempug sendiri. Tugas `baca` dan `browser`: cek acak atas ringkasan. Tugas `edit`: pegang baris verifikasi (`+/−`, `scope`, cek) dan baca `diff <id> <berkas>` hanya untuk file berisiko, bukan semuanya. `⚠ di luar` hanya nama file: bisa pelanggaran agent, bisa juga edit user, jadi jangan menuduh. `⚠ tanpa paham` berarti agent melewati konfirmasi pemahaman.

### Bahasa ke user (aturan keras)

Semua yang kamu tulis kepada user harus bisa dipahami orang yang **tidak tahu rempug ada**. ID tugas, simbol, dan istilah internal hanya untuk kamu dan para agent.

**Dilarang muncul di pesan ke user:**

- ID tugas (`T12`, "tugas 3"), dan nomor apa pun yang hanya bermakna di dalam rempug.
- Simbol status dan tanda baca teknis: `✓ ✗ ⚠ ⏱`, `+41/−7`, `-->`, `--flag`.
- Istilah internal: antrean, `--after`, `--queue`, `terima`, `watch`, `probe`, `ack`, `pointer`, `scope` atau cakupan, `CEK`, `paham`, `klarifikasi`, `kejadian`, nama tool (`browser_tabs`, `snapshot`), dan kata `delegasi` atau `didelegasikan`.
- Dugaan yang belum kamu periksa ("tampaknya berasal dari ...", "belum saya verifikasi"). Periksa dulu sendiri dengan `show <id> --penuh` dan `diff`, baru laporkan hasilnya.
- Cerita tentang caramu bekerja ("saya kirim tanpa antrean", "nanti saya ambil dengan terima").

**Yang boleh:** nama agent yang dipilih user (codex, agy), kata-kata biasa, dan nama berkas atau halaman yang dibicarakan.

Untuk menjawab user, ambil bahan dari `report` dengan `manusia=true` (CLI: `rempug report --manusia`). Keluarannya sudah berupa kalimat biasa. **Jangan menyalin keluaran `log`, `show`, `ls`, `status`, atau kejadian `watch` ke user**; itu bahasa orkestrator. Tulis ulang dengan kata-katamu sendiri bila perlu.

Bentuk laporan: (1) apakah yang diminta user sudah tercapai, (2) bukti yang menentukan dalam bahasa biasa, (3) keputusan yang benar-benar butuh user, bila ada. Jangan menarasikan pengiriman, penantian, atau balasan agent. Agent dilarang `git commit/push/reset/checkout/stash`; perubahan mereka ada di working tree dan commit tetap mengikuti izin user.

| Jangan | Tulis begini |
|---|---|
| "T3 dan T4 ditandai gagal (✗) karena pengecekan browser_tabs. Antrean dengan after ditolak, jadi saya kirim tanpa antrean, lalu saya ambil dengan terima." | "Kedua agent berhasil membuka halaman Devices dan datanya tampil lengkap (922 perangkat, 8 kolom, semua permintaan ke server berhasil). Hasil keduanya sama." |
| "T5 agy ✓ browser, scope ⚠ 1 di luar" | "agy selesai memeriksa halaman. Ada satu berkas yang berubah di luar tugasnya, yaitu README.md; kemungkinan hasil edit Anda sendiri." |
| "limit pada T7, dialihkan ke codex" | "agy kehabisan kuota, jadi pekerjaan itu saya pindahkan ke codex." |
| "T9 menunggu-izin" | "codex menunggu persetujuan Anda di sesinya (pilih izinkan). Pekerjaan lain tetap berjalan." |

Bila rempug menandai tugas gagal tetapi balasan agent menunjukkan pekerjaannya benar, itu kemungkinan alarm palsu: periksa dulu, lalu laporkan **hasil pekerjaannya**, bukan alarmnya.

## Integrasi

**kiro**: satu item `tasks.md` = satu tugas. Kirim dengan `--centang <berkas>#<nomor>` (mis. `spec/tasks.md#2.1`); rempug mencentang tepat baris itu hanya setelah verifikasi lulus. Item yang independen dikirim paralel ke agent berbeda; yang bergantung memakai `--after`.

**grill-me**: pertanyaan yang jawabannya ada di kode atau browser dilempar ke agent `baca` atau `browser` lewat `send`, bukan ditanyakan ke user. Ke user hanya keputusan.

## Pemulihan sesi

Hook awal sesi menjalankan `rempug status` (satu baris) dan membersihkan agent yang sesinya hilang. Bila ia menyebut `baru: ...`, daftarkan hanya bila yakin; bila ragu, tunggu `/rempug`. Bila menyebut `usang: ...`, jalankan `probe <nama>`.
