import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Profil } from "./profile.js";

/** Hasil ukur probe; hanya diisi setelah agent diprobe. */
export interface Ukur {
	/** Milidetik dari kirim sampai agent membaca brief. */
	ackMs?: number;
	/** Layar agent terus berubah walau idle (spinner), jadi hash layar tidak cukup untuk deteksi macet. */
	animasiIdle?: boolean;
	/** Awal baris prompt saat agent siap, mis. `> `. */
	penandaSiap?: string;
	probeAt?: number;
}

export interface Agent {
	name: string;
	kind: string;
	/** Target pane `sesi:window.pane`. */
	tmux: string;
	capabilities: string[];
	/** Profil pengiriman hasil probe; kosong berarti belum diprobe. */
	kirim?: Profil;
	/** Tidak lolos probe, jadi tidak dipakai. */
	tidakAndal?: boolean;
	/** Versi CLI agent saat diprobe; perubahan menandai profil usang. */
	versi?: string;
	ukur?: Ukur;
	/** Pengiriman gagal berturut-turut; dua kali memicu probe ulang. */
	gagalBeruntun?: number;
	/** Catatan hasil probe terakhir bila agent tidak siap. */
	catatan?: string;
}

type Env = Record<string, string | undefined>;

const NAME = /^[a-z][a-z0-9-]{0,29}$/;

/** Lokasi registry; mengikuti `XDG_CONFIG_HOME`, jatuh ke `~/.config`. */
export function registryPath(env: Env = process.env): string {
	const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
	return join(config, "rempug", "registry.json");
}

function isAgent(value: unknown): value is Agent {
	if (typeof value !== "object" || value === null) return false;
	const a = value as Record<string, unknown>;
	return (
		typeof a.name === "string" &&
		typeof a.kind === "string" &&
		typeof a.tmux === "string" &&
		Array.isArray(a.capabilities) &&
		a.capabilities.every((c) => typeof c === "string")
	);
}

/** Agent terdaftar; berkas yang belum ada dianggap kosong. */
export function readAgents(file: string): Agent[] {
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	try {
		const data = JSON.parse(raw) as { agents?: unknown };
		if (!Array.isArray(data.agents) || !data.agents.every(isAgent))
			throw new Error("bentuk tidak dikenal");
		return data.agents;
	} catch (error) {
		throw new Error(`registry rusak: ${file}: ${(error as Error).message}`);
	}
}

function writeAgents(file: string, agents: Agent[]): void {
	mkdirSync(dirname(file), { recursive: true });
	// Tulis ke berkas sementara lalu ganti nama, supaya pembaca tidak pernah melihat berkas setengah jadi.
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify({ agents }, null, 2)}\n`);
	renameSync(temp, file);
}

export function registerAgent(file: string, agent: Agent): void {
	if (!NAME.test(agent.name))
		throw new Error(
			`nama agent "${agent.name}" tidak valid: huruf kecil, angka, atau "-", diawali huruf, maksimal 30 karakter`,
		);
	const agents = readAgents(file);
	if (agents.some((a) => a.name === agent.name))
		throw new Error(`agent "${agent.name}" sudah terdaftar`);
	const dipakai = agents.find((a) => a.tmux === agent.tmux);
	if (dipakai)
		throw new Error(`pane ${agent.tmux} sudah dipakai agent "${dipakai.name}"`);
	writeAgents(file, [...agents, agent]);
}

/** Mengembalikan `true` bila agent ada dan terhapus. */
export function removeAgent(file: string, name: string): boolean {
	const agents = readAgents(file);
	const sisa = agents.filter((a) => a.name !== name);
	if (sisa.length === agents.length) return false;
	writeAgents(file, sisa);
	return true;
}

/** Memperbarui bidang agent (mis. hasil probe); galat bila agent tidak ada. */
export function updateAgent(
	file: string,
	name: string,
	fields: Partial<Omit<Agent, "name">>,
): Agent {
	const agents = readAgents(file);
	const index = agents.findIndex((a) => a.name === name);
	if (index < 0) throw new Error(`agent "${name}" tidak terdaftar`);
	const baru = { ...(agents[index] as Agent), ...fields };
	agents[index] = baru;
	writeAgents(file, agents);
	return baru;
}
