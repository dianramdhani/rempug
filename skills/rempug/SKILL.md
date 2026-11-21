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
| `pelanggaran`                            | HEAD atau branch berubah: hentikan, laporkan ke user, jangan menumpuk tugas di atasnya                                                             |
| `diterima-tanpa-ack`                     | Agent menerima pointer tetapi tidak menjalankan rempug; alihkan                                                                                    |

### Kebijakan peninjauan

Jangan mempercayai klaim agent; baris verifikasi dihitung rempug sendiri. Tugas `baca` dan `browser`: cek acak atas ringkasan. Tugas `edit`: pegang baris verifikasi (`+/−`, `scope`, cek) dan baca `diff <id> <berkas>` hanya untuk file berisiko, bukan semuanya. `⚠ di luar` hanya nama file: bisa pelanggaran agent, bisa juga edit user, jadi jangan menuduh. `⚠ tanpa paham` berarti agent melewati konfirmasi pemahaman.

### Laporan ke user

Hanya hasil: apakah tujuan user tercapai, bukti yang menentukan (mis. "tsc, biome, vitest lulus; 3 file berubah"), dan keputusan yang butuh user. Jangan menarasikan pengiriman, penantian, atau balasan agent. Agent dilarang `git commit/push/reset/checkout/stash`; perubahan mereka ada di working tree dan commit tetap mengikuti izin user.

## Integrasi

**kiro**: satu item `tasks.md` = satu tugas. Kirim dengan `--centang <berkas>#<nomor>` (mis. `spec/tasks.md#2.1`); rempug mencentang tepat baris itu hanya setelah verifikasi lulus. Item yang independen dikirim paralel ke agent berbeda; yang bergantung memakai `--after`.

**grill-me**: pertanyaan yang jawabannya ada di kode atau browser dilempar ke agent `baca` atau `browser` lewat `send`, bukan ditanyakan ke user. Ke user hanya keputusan.

## Pemulihan sesi

Hook awal sesi menjalankan `rempug status` (satu baris) dan membersihkan agent yang sesinya hilang. Bila ia menyebut `baru: ...`, daftarkan hanya bila yakin; bila ragu, tunggu `/rempug`. Bila menyebut `usang: ...`, jalankan `probe <nama>`.
