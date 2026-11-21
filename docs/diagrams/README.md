# Diagram

Sumbernya adalah berkas `.mmd` (Mermaid). README memakai hasil render PNG-nya karena npmjs.com tidak merender Mermaid.

| Sumber | Gambar |
|---|---|
| `gambaran-besar.mmd` | `gambaran-besar.png` |
| `satu-tugas.mmd` | `satu-tugas.png` |
| `tangga-masalah.mmd` | `tangga-masalah.png` |

## Membuat ulang gambar

Ubah `.mmd`, lalu render ulang PNG-nya dan commit keduanya. Cara yang dipakai untuk gambar yang ada (Mermaid 12.3.0):

1. Letakkan `render.html`, `mermaid.min.js` (dari `node_modules/mermaid/dist/`), dan berkas `.mmd` dalam satu folder, lalu layani dari `127.0.0.1` (mis. `python3 -m http.server --bind 127.0.0.1`).
2. Buka `render.html?d=<nama-tanpa-ekstensi>` di browser.
3. Tangkap layar elemen `#kotak` sebagai PNG (halaman sudah diperbesar 2x agar tajam, latar putih).
4. **Periksa gambarnya dengan mata**: label yang terpotong atau bertumpuk tidak terdeteksi oleh parser, hanya terlihat di hasil render.

`@mermaid-js/mermaid-cli` seharusnya juga bisa, tetapi belum dicoba di sini.
