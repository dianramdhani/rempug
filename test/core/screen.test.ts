import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	hashLayar,
	klasifikasi,
	normalisasi,
	pertanyaan,
} from "../../src/core/screen.js";

const TOKEN = "rempug brief T12";
const dasar = { berubah: false, token: TOKEN };

test("layar yang masih berubah adalah bekerja", () => {
	assert.equal(
		klasifikasi({ ...dasar, berubah: true, baris: ["apa saja"] }),
		"bekerja",
	);
});

test("menunggu-izin dikenali dari pola umum, dan pola tambahan profil", () => {
	for (const teks of [
		"Allow this command to run? (y/n)",
		"Do you want to proceed?",
		"Approve edit to src/a.ts?",
		"Continue [Y/n]",
		"Press enter to confirm",
		"Izinkan perintah ini?",
		"Do you trust the contents of this project?",
		"Trust this folder? Codex can read, edit, and run files here",
	]) {
		assert.equal(
			klasifikasi({ ...dasar, baris: ["...", teks, "> "] }),
			"menunggu-izin",
			teks,
		);
	}
	assert.equal(
		klasifikasi({ ...dasar, baris: ["Silakan setujui dulu"] }),
		"siap",
	);
	assert.equal(
		klasifikasi({
			...dasar,
			baris: ["Silakan setujui dulu"],
			polaIzin: ["setujui"],
		}),
		"menunggu-izin",
	);
});

test("error limit dikenali", () => {
	for (const teks of [
		"You have hit your usage limit.",
		"Error: rate limit exceeded",
		"429 Too Many Requests",
		"Quota exceeded for this model",
		"Your credit balance is too low",
		"Token refresh failed: 401",
		"Error: 401 Unauthorized",
		"Authentication failed, please log in again",
		"Invalid API key provided",
	]) {
		assert.equal(klasifikasi({ ...dasar, baris: [teks] }), "error", teks);
	}
});

test("izin dan limit di riwayat jauh di atas tidak dianggap", () => {
	const riwayat = [
		"Allow this? (y/n)",
		"rate limit",
		...Array.from({ length: 12 }, (_, i) => `baris ${i}`),
	];
	assert.equal(klasifikasi({ ...dasar, baris: riwayat }), "siap");
});

test("tertahan: token ada di baris kursor atau dua baris di atasnya", () => {
	const baris = [
		"riwayat",
		"",
		"+----+",
		"> Tugas T12: jalankan `rempug brief T12`, kerjakan",
	];
	assert.equal(klasifikasi({ ...dasar, baris, kursorY: 3 }), "tertahan");
	const terbungkus = [
		"+----+",
		"> Tugas T12: jalankan `rempug",
		"brief T12`, kerjakan persis",
		"isinya",
	];
	assert.equal(
		klasifikasi({ ...dasar, baris: terbungkus, kursorY: 3 }),
		"tertahan",
	);
});

test("pesan terkirim yang bergema di riwayat bukan tertahan", () => {
	const baris = [
		"you: Tugas T12: jalankan `rempug brief T12`, kerjakan",
		"",
		"+------+",
		"> ",
	];
	assert.equal(klasifikasi({ ...dasar, baris, kursorY: 3 }), "siap");
});

test("tanpa posisi kursor, token di tiga baris terakhir dianggap tertahan", () => {
	assert.equal(
		klasifikasi({ ...dasar, baris: ["a", "b", "c", "> x `rempug brief T12`"] }),
		"tertahan",
	);
	assert.equal(
		klasifikasi({
			...dasar,
			baris: ["`rempug brief T12`", "b", "c", "d", "> "],
		}),
		"siap",
	);
});

test("bertanya: baris pertanyaan dalam delapan baris terakhir, bukan baris pointer", () => {
	assert.equal(
		klasifikasi({
			...dasar,
			baris: ["Which option do you prefer, A or B?", "+---+", "> "],
		}),
		"bertanya",
	);
	assert.equal(
		klasifikasi({ ...dasar, baris: ["│ Apakah ini benar? │", "> "] }),
		"bertanya",
	);
	assert.equal(
		klasifikasi({
			...dasar,
			baris: ["you: apakah `rempug brief T12` jalan?", "", "+---+", "> "],
			kursorY: 3,
		}),
		"siap",
	);
});

test("pertanyaan mengembalikan teks pertanyaan tanpa garis kotak, dipotong", () => {
	assert.equal(
		pertanyaan(["│ Mau pakai A atau B? │", "+---+"]),
		"Mau pakai A atau B?",
	);
	assert.equal(pertanyaan(["tidak ada"]), undefined);
	assert.equal(pertanyaan([`${"x".repeat(300)}?`])?.length, 200);
});

test("normalisasi membuang spinner, angka, dan spasi berlebih, tetapi teks baru tetap membuat hash berubah", () => {
	assert.equal(
		normalisasi("⠋ Working 12s  (esc to cancel)"),
		normalisasi("⠙ Working 13s (esc to cancel)"),
	);
	assert.equal(normalisasi("fake | 1"), normalisasi("fake / 2"));
	assert.notEqual(
		hashLayar("Working..."),
		hashLayar("Working... membaca berkas"),
	);
	assert.equal(hashLayar("⠋ Working 1s"), hashLayar("⠙ Working 2s"));
});

/** Layar asli codex dan Antigravity yang direkam saat menjalankan `sleep 70`; lihat test/fixtures/layar. */
const layarAsli = (nama: string) =>
	readFileSync(
		new URL(`../../../test/fixtures/layar/${nama}.txt`, import.meta.url),
		"utf8",
	).split("\n");

test("layar asli saat agent bekerja dikenali sebagai bekerja walau tampak diam (timer diabaikan)", () => {
	for (const nama of [
		"codex-bekerja",
		"codex-bekerja-lama",
		"agy-berpikir",
		"agy-tugas-latar-belakang",
		"agy-menyusun-jawaban",
	])
		assert.equal(
			klasifikasi({ baris: layarAsli(nama), berubah: false }),
			"bekerja",
			nama,
		);
});

test("layar asli setelah agent selesai dikenali sebagai siap", () => {
	for (const nama of ["codex-selesai", "agy-selesai"])
		assert.equal(
			klasifikasi({ baris: layarAsli(nama), berubah: false }),
			"siap",
			nama,
		);
});

test("penanda sibuk tidak menutupi prompt izin dan limit, dan tidak membuat kata biasa terbaca sibuk", () => {
	// Dialog izin codex memuat "esc to cancel"; tetap harus terbaca sebagai menunggu izin.
	assert.equal(
		klasifikasi({
			baris: [
				"Would you like to run this command?",
				"Press enter to confirm or esc to cancel",
			],
			berubah: false,
		}),
		"menunggu-izin",
	);
	assert.equal(
		klasifikasi({
			baris: ["esc to interrupt", "rate limit exceeded"],
			berubah: false,
		}),
		"error",
	);
	// Teks biasa yang menyebut "3 tasks" atau "Working" di riwayat bukan penanda sibuk.
	assert.equal(
		klasifikasi({
			baris: ["Selesai mengerjakan 3 tasks", "> "],
			berubah: false,
		}),
		"siap",
	);
	assert.equal(
		klasifikasi({
			baris: ["Saya Working di folder lain", "> "],
			berubah: false,
		}),
		"siap",
	);
});

test("penanda sibuk didahulukan dari teks yang tertahan di kotak input", () => {
	const baris = [
		"• Working (3s • esc to interrupt)",
		"",
		"> Tugas T5: jalankan `rempug brief T5`",
	];
	assert.equal(
		klasifikasi({
			baris,
			kursorY: 2,
			berubah: false,
			token: "rempug brief T5",
		}),
		"bekerja",
	);
});

test("galat autentikasi opencode di tata letak dua kolom: terlewat pada jendela 8 baris, tertangkap pada jendela layar penuh", () => {
	const layar = layarAsli("opencode-galat-401");
	// Jendela bawaan sengaja sempit supaya riwayat lama di atas layar tidak dianggap keadaan saat ini.
	assert.notEqual(klasifikasi({ baris: layar, berubah: false }), "error");
	// Probe memeriksa layar yang masih baru, jadi seluruh layar boleh dibaca.
	assert.equal(
		klasifikasi({ baris: layar, berubah: false, jendela: 60 }),
		"error",
	);
});

test("jendela lebar tidak mengubah hasil layar yang tidak memuat galat", () => {
	for (const nama of ["codex-selesai", "agy-selesai", "codex-bekerja"])
		assert.equal(
			klasifikasi({ baris: layarAsli(nama), berubah: false, jendela: 60 }),
			klasifikasi({ baris: layarAsli(nama), berubah: false }),
			nama,
		);
});
