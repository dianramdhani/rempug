# rempug

Delegasi kerja dari satu agent **orkestrator** (mis. Claude Code) ke agent CLI lain (Codex, Antigravity, opencode, Claude) yang berjalan di sesi **tmux**. Hemat token, terverifikasi mesin, dan tanpa file sampah di proyek.

Anda hanya mengetik `/rempug` sekali. Sesudah itu orkestrator mendelegasikan, menunggu, memverifikasi, mengulang, dan mengalihkan pekerjaan sendiri; Anda hanya menilai apakah hasil yang Anda minta sudah benar.

## Kenapa

- Membaca layar tmux mentah boros token dan rawan salah baca. Hasil kerja kembali lewat **perintah**, bukan lewat scrape layar.
- Agent berupa model murah, jadi klaim mereka tidak dipercaya. **rempug menghitung sendiri** file yang berubah, menjalankan cek penerimaan, dan mendeteksi commit diam-diam.
- Orkestrator tidak perlu diingatkan: `rempug watch` mendorong satu baris per kejadian, dengan kursor yang tersimpan sehingga tidak ada kejadian yang hilang.
- Semua status disimpan di satu berkas SQLite di luar repo. Tidak ada `tasks/`, `state/`, atau `evidence/` di proyek Anda.

## Kebutuhan

- Linux atau macOS (butuh `tmux`)
- Node.js 22.13 atau lebih baru (memakai `node:sqlite` bawaan, tanpa dependensi native)

## Pemasangan

```bash
npm i -g rempug
```

Lalu pasang skill dan server MCP untuk Claude Code, salah satunya:

```bash
# Plugin: skill /rempug + server MCP + hook awal sesi sekaligus
claude plugin marketplace add dianramdhani/rempug
claude plugin install rempug

# Atau manual
rempug skill install
claude mcp add --scope user rempug -- rempug mcp
```

Agent yang Anda delegasikan harus bisa menjalankan `rempug` dari shell-nya (`rempug doctor` memeriksanya).

## Pemakaian

Siapkan sesi tmux dan jalankan agent di dalamnya (beserta apa pun yang perlu disiapkan, mis. sesi Playwright), lalu di orkestrator:

```
/rempug
```

Orkestrator memindai tmux, menebak mana yang agent, bertanya **satu kali** untuk penamaan, lalu **mengukur** tiap agent (probe) dan menampilkan tabel kesiapan:

```
agy       ✓ siap  ack 1.8 dtk
codex     ✓ siap  ack 2.4 dtk
opencode  ✗ tidak-andal  teks tertahan di kotak input; 7 kombinasi dicoba
```

Sesudahnya Anda cukup meminta hasil. Orkestrator memutuskan sendiri apa yang dibagi ke agent dan hanya melaporkan hasilnya: tujuan tercapai atau belum, bukti yang menentukan, dan keputusan yang butuh Anda. Hook awal sesi memulihkan status di sesi berikutnya, jadi `/rempug` tidak perlu diulang.

## Cara kerja

1. `send` memvalidasi **brief** (TUJUAN, CAKUPAN, LANGKAH, CEK, BALASAN), menolak cakupan yang beririsan dengan tugas edit lain, mengambil snapshot berkas, lalu mengetik **satu baris pointer** ke pane agent.
2. Agent menjalankan `rempug brief` (ini bukti pengiriman), mengonfirmasi pemahaman lewat `rempug paham`, bekerja, lalu `rempug reply`. Konfirmasi yang cocok dengan brief disetujui otomatis tanpa token orkestrator.
3. Verifikasi berjalan di proses terlepas: berkas yang berubah (+/−), perubahan di luar cakupan (hanya nama), cek penerimaan yang dijalankan rempug sendiri, dan commit atau pindah branch.
4. `watch` mencetak satu baris, mis. `T12 codex ✓ 3 file +41/−7 | scope OK | tsc ✓ vitest ✗(2)`.

Pemantau layar berjalan di dalam `watch`: mengulang pengiriman yang tertahan, melaporkan pertanyaan, prompt izin, dan limit, mengirim satu pengingat, lalu menyatakan agent macet. **Prompt izin tidak pernah dijawab otomatis.**

## Perintah

Untuk orkestrator: `scan`, `register`, `probe`, `ls`, `status`, `doctor`, `send`, `jawab`, `log`, `show`, `diff`, `report`, `layar`, `watch`, `terima`.
Untuk agent: `brief`, `paham`, `tunggu`, `reply`.
Semuanya juga tersedia sebagai tool MCP (`rempug mcp`), kecuali `watch`. Jalankan `rempug --help` untuk pemakaian lengkap.

## Konfigurasi

| Variabel | Fungsi | Bawaan |
|---|---|---|
| `XDG_STATE_HOME` | Lokasi ledger (`rempug/ledger.db`) | `~/.local/state` |
| `XDG_CONFIG_HOME` | Lokasi registry agent | `~/.config` |
| `REMPUG_RETENTION_DAYS` | Masa simpan tugas | 30 |
| `REMPUG_ACK_DETIK` | Batas menunggu agent membaca brief | 45 |
| `REMPUG_DIAM_DETIK` | Layar tidak berubah selama ini dianggap diam | 10 |
| `REMPUG_MACET_DETIK` | Diam selama ini tanpa balasan berarti macet | 120 |
| `REMPUG_WATCH_MS` | Selang `watch` | 1000 |
| `REMPUG_TMUX_SOCKET` | Memakai server tmux lain (`tmux -L`) | server bawaan |
| `CLAUDE_CONFIG_DIR` | Lokasi pemasangan skill | `~/.claude` |

## Batasan yang perlu diketahui

- **Deteksi keadaan layar bersifat heuristik** (teks tertahan, pertanyaan, prompt izin, limit). Ia teruji terhadap TUI palsu yang meniru perilaku berbeda, tetapi belum divalidasi terhadap setiap TUI sungguhan. Agent yang gagal probe ditandai `tidak-andal` dan tidak dipakai.
- Konfirmasi pemahaman menangkap salah paham pada **cakupan, cek, dan tindakan terlarang**, bukan salah paham makna pada TUJUAN. Untuk tugas berisiko gunakan `--teliti`; verifikasi sesudah kerja tetap menjadi jaring terakhir.
- Pengecekan cakupan sengaja **konservatif**: path tanpa wildcard dianggap sebagai dirinya sendiri beserta isinya.
- Windows tidak didukung (tmux).

## Pengembangan

```bash
npm ci
npm run check       # Biome
npm run typecheck
npm test            # butuh tmux; termasuk uji ujung ke ujung
```

Commit mengikuti [Conventional Commits](https://www.conventionalcommits.org/); versi, `CHANGELOG.md`, GitHub Release, dan publish npm dihasilkan otomatis oleh semantic-release dari cabang `main`.

## Lisensi

MIT
