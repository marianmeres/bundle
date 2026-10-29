import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { isFile } from "./utils.ts";

/**
 * Finds the nearest `tsconfig.json`, walking up from `startDir` toward the
 * filesystem root — the same "closest config wins" rule editors use, so an
 * `example/tsconfig.json` (say, one adding the DOM lib) applies to an
 * `example/src` entry.
 *
 * @param startDir - Directory to begin searching from
 * @returns Absolute path to the config, or undefined if none found
 */
export async function findTsconfig(startDir: string): Promise<string | undefined> {
	let current = resolve(startDir);
	while (true) {
		const candidate = join(current, "tsconfig.json");
		if (await isFile(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * Absolute path of the `tsc` script of the TypeScript the project at `fromDir`
 * resolves (its own devDependency, not one bundled here), or undefined.
 */
function resolveTsc(fromDir: string): string | undefined {
	try {
		const require = createRequire(join(fromDir, "noop.js"));
		const pkgPath = require.resolve("typescript/package.json");
		const pkg = require(pkgPath);
		const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsc;
		return typeof bin === "string" ? join(dirname(pkgPath), bin) : undefined;
	} catch {
		return undefined;
	}
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
let seq = 0;

/**
 * Type-checks the module graph of `entryPath` with the project's `tsc`.
 *
 * `tsc file.ts` ignores tsconfig.json, and `tsc -p tsconfig.json` checks
 * whatever that config includes rather than the entry's graph. So this writes a
 * throwaway config next to `tsconfigPath` that extends it and narrows the input
 * to the entry alone (`files: [entry]`, `include: []`, `noEmit`). Sitting in the
 * same directory keeps every directory-relative setting (`typeRoots`, `types`,
 * `${configDir}`) resolving exactly as it does for the real config. The file is
 * removed afterwards, also when the process is interrupted mid-check.
 *
 * Diagnostics go to stderr (tsc's stdout is redirected there), keeping stdout
 * free for `--skip-write` output.
 *
 * @param entryPath - Absolute path to the entry point file to check
 * @param tsconfigPath - Config to extend (default: nearest `tsconfig.json` at
 *   or above the entry's directory)
 * @returns True if type checking passes, false on type errors
 * @throws Error if no tsconfig.json is found, or TypeScript is not installed
 */
export async function typeCheck(
	entryPath: string,
	tsconfigPath?: string,
): Promise<boolean> {
	const tsconfig = tsconfigPath ?? (await findTsconfig(dirname(entryPath)));
	if (!tsconfig) {
		throw new Error(
			`Type checking needs a tsconfig.json at or above ${dirname(entryPath)}`,
		);
	}
	const configDir = dirname(tsconfig);
	const tsc = resolveTsc(configDir);
	if (!tsc) {
		throw new Error(
			`Type checking needs TypeScript installed in the project (not resolvable from ${configDir}); e.g. pnpm add -D typescript`,
		);
	}

	const tmpConfig = join(
		configDir,
		`.tsconfig.bundle-check-${process.pid}-${++seq}.json`,
	);
	const cleanup = () => rmSync(tmpConfig, { force: true });
	const onSignal = (signal: NodeJS.Signals) => {
		cleanup();
		release();
		// Re-raise so the default handler still terminates the process, unless
		// the host installed its own handler and decides for itself.
		if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
	};
	const release = () => {
		for (const s of SIGNALS) process.off(s, onSignal);
	};
	for (const s of SIGNALS) process.on(s, onSignal);

	try {
		await writeFile(
			tmpConfig,
			JSON.stringify({
				extends: `./${basename(tsconfig)}`,
				compilerOptions: {
					noEmit: true,
					emitDeclarationOnly: false,
					incremental: false,
					composite: false,
				},
				files: [entryPath],
				include: [],
			}),
		);
		const code = await new Promise<number | null>((done, fail) => {
			const child = spawn(process.execPath, [tsc, "-p", tmpConfig], {
				stdio: ["ignore", 2, 2],
			});
			child.on("error", fail);
			child.on("close", done);
		});
		return code === 0;
	} finally {
		release();
		cleanup();
	}
}
