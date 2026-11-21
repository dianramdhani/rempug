/** Galat yang pesannya aman ditampilkan apa adanya; `kode` menjadi kode keluar CLI. */
export class RempugError extends Error {
	constructor(
		message: string,
		readonly kode: number = 1,
	) {
		super(message);
		this.name = "RempugError";
	}
}

/** Masukan pemakai salah (brief tidak lengkap, argumen keliru): kode keluar 2. */
export class UsageError extends RempugError {
	constructor(message: string) {
		super(message, 2);
		this.name = "UsageError";
	}
}
