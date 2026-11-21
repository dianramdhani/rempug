import type { Ledger } from "./ledger.js";
import { type Agent, readAgents, registerAgent } from "./registry.js";
import { listPanes, type TmuxOpts } from "./tmux.js";

export type AgentStatus = "siap" | "sibuk" | "hilang";

export interface AgentRow extends Agent {
	status: AgentStatus;
	/** ID tugas aktif bila agent sibuk. */
	tugas: number | undefined;
}

/** Mendaftarkan agent setelah memastikan pane-nya ada di tmux. */
export function register(file: string, agent: Agent, tmux?: TmuxOpts): Agent {
	if (!listPanes(tmux).some((p) => p.target === agent.tmux))
		throw new Error(`pane "${agent.tmux}" tidak ada di tmux`);
	registerAgent(file, agent);
	return agent;
}

/** Satu baris per agent terdaftar, dengan status dari tmux dan ledger. */
export function agentRows(
	file: string,
	ledger: Ledger,
	tmux?: TmuxOpts,
): AgentRow[] {
	const targets = new Set(listPanes(tmux).map((p) => p.target));
	return readAgents(file).map((agent) => {
		if (!targets.has(agent.tmux))
			return { ...agent, status: "hilang", tugas: undefined };
		const aktif = ledger.activeTaskOf(agent.name);
		return aktif
			? { ...agent, status: "sibuk", tugas: aktif.id }
			: { ...agent, status: "siap", tugas: undefined };
	});
}

/** Agent yang boleh menerima tugas; menolak yang tidak terdaftar atau sesinya hilang. */
export function requireAvailable(rows: AgentRow[], name: string): AgentRow {
	const row = rows.find((r) => r.name === name);
	if (!row) throw new Error(`agent "${name}" tidak terdaftar`);
	if (row.tidakAndal)
		throw new Error(
			`agent "${name}" tidak andal (gagal probe); jalankan /rempug untuk mengujinya lagi`,
		);
	if (row.status === "hilang")
		throw new Error(
			`agent "${name}" hilang: pane ${row.tmux} tidak ada lagi di tmux`,
		);
	return row;
}

export function formatAgentRow(row: AgentRow): string {
	const kemampuan = row.capabilities.length ? row.capabilities.join(",") : "-";
	const tugas = row.tugas === undefined ? "" : `  T${row.tugas}`;
	return `${row.name.padEnd(10)}${row.status}  ${kemampuan}${tugas}`;
}
