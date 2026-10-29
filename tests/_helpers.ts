// Shared fixtures: throwaway projects in the OS temp dir.

import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** This repo's node_modules: linked into fixtures that need `typescript`. */
export const REPO_NODE_MODULES = fileURLToPath(
	new URL("../node_modules", import.meta.url),
);

export const ENTRY = "export const x = 1;\n";

/** A tsconfig fixtures are checked against: bundler-style, no DOM, no Node globals. */
export const TSCONFIG = JSON.stringify({
	compilerOptions: {
		target: "es2024",
		lib: ["es2024"],
		module: "preserve",
		moduleResolution: "bundler",
		strict: true,
		noEmit: true,
		allowImportingTsExtensions: true,
		types: [],
	},
});

/**
 * Creates a temp project from a `{ relativePath: content }` map (default: just
 * `src/mod.ts`) and returns its absolute path. `linkNodeModules` symlinks this
 * repo's node_modules in, so `typescript` resolves from the fixture.
 */
export async function makeProject(
	files: Record<string, string> = { "src/mod.ts": ENTRY },
	{ linkNodeModules = false } = {},
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "bundle-test-"));
	for (const [rel, content] of Object.entries(files)) {
		const path = join(dir, rel);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content);
	}
	if (linkNodeModules) await symlink(REPO_NODE_MODULES, join(dir, "node_modules"));
	return dir;
}

export const removeProject = (dir: string): Promise<void> =>
	rm(dir, { recursive: true, force: true });

/** Sorted file names in a directory. */
export async function listDir(dir: string): Promise<string[]> {
	return (await readdir(dir)).sort();
}

export const read = (path: string): Promise<string> => readFile(path, "utf8");

/** `build()` options pointing at a fixture: absolute paths, so cwd does not matter. */
export function buildOpts(dir: string, extra: Record<string, unknown> = {}) {
	return {
		root: join(dir, "src"),
		entry: "mod.ts",
		outDir: join(dir, "dist"),
		outFile: "bundle.js",
		...extra,
	};
}

/** Polls `check` until it returns true; throws after `timeoutMs`. */
export async function waitFor(
	check: () => Promise<boolean> | boolean,
	timeoutMs = 5000,
): Promise<void> {
	const start = Date.now();
	while (!(await check())) {
		if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
		await new Promise((r) => setTimeout(r, 25));
	}
}
