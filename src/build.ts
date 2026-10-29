import { type FSWatcher, watch } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import * as esbuild from "esbuild";
import { emitHashedOutputs } from "./hash.ts";
import { findTsconfig, typeCheck } from "./typecheck.ts";
import {
	type BuildOptions,
	EntryNotFoundError,
	isFile,
	logLine,
	pathExists,
	resolveBuildOptions,
} from "./utils.ts";

/**
 * Bundles a TypeScript (or JavaScript) entry point and everything it imports
 * into a single browser-ready ES module, using esbuild.
 *
 * Imports resolve the way Node resolves them: relative paths, `node_modules`
 * packages, `package.json` `imports` and tsconfig `paths`. `jsr:`, `npm:` and
 * URL specifiers are not supported.
 *
 * @param options - Build configuration options (all fields optional)
 * @returns The bundled code as a string
 * @throws {EntryNotFoundError} if the entry point file does not exist
 * @throws Error if type checking fails (when `strict` is enabled)
 * @throws Error if bundling fails
 * @example
 * ```ts
 * import { build } from "@marianmeres/bundle";
 *
 * // Defaults: src/mod.ts -> ./dist/bundle.js
 * const code = await build();
 *
 * // With options
 * const code2 = await build({
 *   root: "src",
 *   entry: "mod.ts",
 *   outDir: "./dist",
 *   outFile: "bundle.js",
 *   minify: true,
 * });
 *
 * // Get code only without writing to file
 * const codeOnly = await build({ skipWrite: true });
 * ```
 */
export async function build(options: BuildOptions = {}): Promise<string> {
	const { root, entry, outDir, outFile, strict, minify, skipWrite, hash, manifest } =
		resolveBuildOptions(options);

	const cwd = process.cwd();
	const entryPath = resolve(cwd, root, entry);
	const outDirPath = resolve(cwd, outDir);
	const outPath = resolve(outDirPath, outFile);

	if (!(await isFile(entryPath))) {
		throw new EntryNotFoundError(entryPath);
	}

	try {
		if (strict) {
			const tsconfig = await findTsconfig(dirname(entryPath));
			const label = tsconfig ? ` (${relative(cwd, tsconfig)})` : "";
			logLine(`Type checking ${root}/${entry}${label}...`);
			if (!(await typeCheck(entryPath, tsconfig))) {
				throw new Error("Type checking failed");
			}
		}

		logLine(`Building ${root}/${entry}${minify ? " [minify]" : ""}...`);

		// write: false — the code is returned and written below in a single I/O,
		// and --skip-write never touches the disk.
		const result = await esbuild.build({
			entryPoints: [entryPath],
			bundle: true,
			format: "esm",
			minify,
			write: false,
		});
		const code = result.outputFiles[0]?.text;
		if (code === undefined) {
			throw new Error("esbuild produced no output files");
		}

		if (!skipWrite) {
			await mkdir(outDirPath, { recursive: true });
			await writeFile(outPath, code);
			logLine(`  ✓ ${relative(cwd, outPath)}`, "green");

			// Additively emit a content-hashed copy + manifest for cache-busting.
			// The stable file above is left untouched.
			if (hash) {
				const { hashedFile, manifestFile } = await emitHashedOutputs({
					outDir: outDirPath,
					outFile,
					manifest,
					code,
				});
				for (const f of [hashedFile, manifestFile]) {
					logLine(`  ✓ ${relative(cwd, f)}`, "green");
				}
			}
		}

		return code;
	} catch (error) {
		logLine(`Build failed: ${error instanceof Error ? error.message : error}`, "red");
		throw error;
	}
}

/** Options for {@link watchAndRebuild}: the build options plus a stop signal. */
export interface WatchOptions extends BuildOptions {
	/**
	 * Stops watching when aborted. The promise returned by
	 * {@link watchAndRebuild} then resolves, once any in-flight rebuild is done.
	 */
	signal?: AbortSignal;
}

/** Files whose change triggers a rebuild. */
const RELEVANT_FILE = /\.(?:ts|tsx|js|jsx)$/;

/**
 * Watches source directories for changes and triggers rebuilds automatically.
 *
 * Monitors the source root directory and any additional directories specified
 * in `watchDirs` (recursively). Rebuilds are debounced (100ms) to prevent
 * excessive builds during rapid file changes, and serialized so a rebuild
 * cannot start while a previous one is still running. Only `.ts`, `.tsx`, `.js`,
 * and `.jsx` files trigger rebuilds, and everything under `outDir` is ignored
 * to avoid feedback loops.
 *
 * Does not build up front: call {@link build} first (the CLI does).
 *
 * @param options - Build configuration options (same as {@link build}), plus
 *   an optional `signal` to stop watching
 * @returns A promise that resolves only when `signal` aborts; without a signal
 *   it never resolves
 * @throws Error if any watched directory does not exist, or a watcher fails
 */
export async function watchAndRebuild(options: WatchOptions = {}): Promise<void> {
	const { signal, ...buildOptions } = options;
	const opts = resolveBuildOptions(buildOptions);
	const cwd = process.cwd();
	const watchPaths = [opts.root, ...opts.watchDirs].map((d) => resolve(cwd, d));

	for (const p of watchPaths) {
		if (!(await pathExists(p))) {
			throw new Error(`Watch directory does not exist: ${p}`);
		}
	}

	const outDirPath = resolve(cwd, opts.outDir);
	// Ignore everything under the output directory (stable bundle, hashed copy,
	// and manifest) so our own writes can't trigger a rebuild feedback loop.
	const isInOutDir = (p: string) => {
		const rel = relative(outDirPath, p);
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	};

	console.error();
	logLine(
		`Watching for changes:\n${watchPaths.map((p) => `    ${p}`).join("\n")}\n`,
		"cyan",
	);

	let debounceTimeout: ReturnType<typeof setTimeout> | undefined;
	let inFlight: Promise<void> | undefined;
	let pending = false;
	let stopped = false;

	const triggerRebuild = () => {
		if (stopped) return;
		if (inFlight) {
			pending = true;
			return;
		}
		inFlight = (async () => {
			try {
				await build(buildOptions);
			} catch (error) {
				// build() logs its own failures; a missing entry is thrown before that
				if (error instanceof EntryNotFoundError) {
					logLine(`Error: ${error.message}`, "red");
				}
			}
			if (!stopped) {
				console.error();
				logLine("Watching for changes...", "cyan");
			}
		})().finally(() => {
			inFlight = undefined;
			if (pending) {
				pending = false;
				triggerRebuild();
			}
		});
	};

	return new Promise<void>((done, fail) => {
		const watchers: FSWatcher[] = [];
		const stop = () => {
			stopped = true;
			pending = false;
			clearTimeout(debounceTimeout);
			for (const w of watchers) w.close();
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			stop();
			Promise.resolve(inFlight).then(() => done());
		};
		const onChange = (dir: string, filename: string | null) => {
			// filename can be null on some platforms; rebuild rather than miss a change
			if (filename !== null) {
				const p = resolve(dir, filename);
				if (isInOutDir(p) || !RELEVANT_FILE.test(p)) return;
			}
			clearTimeout(debounceTimeout);
			debounceTimeout = setTimeout(triggerRebuild, 100);
		};

		try {
			for (const dir of watchPaths) {
				const watcher = watch(dir, { recursive: true }, (_event, filename) =>
					onChange(dir, filename),
				);
				watcher.on("error", (error) => {
					stop();
					fail(error);
				});
				watchers.push(watcher);
			}
		} catch (error) {
			stop();
			fail(error);
			return;
		}

		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
	});
}
