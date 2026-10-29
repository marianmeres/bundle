import { readFile, stat } from "node:fs/promises";
import { styleText } from "node:util";

/**
 * Configuration options for the build process.
 *
 * All fields are optional; sensible defaults are used when omitted.
 */
export interface BuildOptions {
	/** Source root directory relative to cwd (default: "src") */
	root?: string;
	/** Entry point file name within root (default: "mod.ts") */
	entry?: string;
	/** Output directory relative to cwd (default: "./dist") */
	outDir?: string;
	/** Output file name (default: "bundle.js") */
	outFile?: string;
	/** Additional directories to watch in watch mode (default: []) */
	watchDirs?: string[];
	/**
	 * Type-check the entry point with the project's `tsc` before bundling
	 * (default: false). See {@link typeCheck}.
	 */
	strict?: boolean;
	/** Minify the output bundle (default: false) */
	minify?: boolean;
	/** Skip writing to file; only return bundled code (default: false) */
	skipWrite?: boolean;
	/**
	 * Emit a content-hashed copy of the bundle (`bundle.<hash>.js`) plus a
	 * manifest mapping the logical name to the hashed name, for cache-busting.
	 * The stable `outFile` is still written. Has no effect with `skipWrite`.
	 * (default: false)
	 */
	hash?: boolean;
	/**
	 * Manifest file name written within `outDir` when `hash` is enabled.
	 * Defaults to `${outFile}${DEFAULT_MANIFEST_SUFFIX}` (e.g.
	 * `bundle.js.manifest.json`) — namespaced to the outfile so it won't clash
	 * with an unrelated `manifest.json` (e.g. a PWA web app manifest).
	 */
	manifest?: string;
}

/**
 * Fully-resolved build options — every field is populated with a default.
 * Used internally; returned by {@link resolveBuildOptions}.
 */
export interface ResolvedBuildOptions {
	root: string;
	entry: string;
	outDir: string;
	outFile: string;
	watchDirs: string[];
	strict: boolean;
	minify: boolean;
	skipWrite: boolean;
	hash: boolean;
	manifest: string;
}

/** Default source root directory */
export const DEFAULT_ROOT: string = "src";

/** Default entry point file name */
export const DEFAULT_ENTRY_POINT: string = "mod.ts";

/** Default output file name */
export const DEFAULT_OUT_FILENAME: string = "bundle.js";

/** Default output directory */
export const DEFAULT_OUT_DIR: string = "./dist";

/**
 * Default suffix appended to `outFile` to derive the manifest name when `hash`
 * is enabled and no explicit `manifest` is given (e.g. `bundle.js` →
 * `bundle.js.manifest.json`).
 */
export const DEFAULT_MANIFEST_SUFFIX: string = ".manifest.json";

/**
 * Fills in defaults for any omitted {@link BuildOptions} fields.
 */
export function resolveBuildOptions(options: BuildOptions = {}): ResolvedBuildOptions {
	const outFile = options.outFile ?? DEFAULT_OUT_FILENAME;
	return {
		root: options.root ?? DEFAULT_ROOT,
		entry: options.entry ?? DEFAULT_ENTRY_POINT,
		outDir: options.outDir ?? DEFAULT_OUT_DIR,
		outFile,
		watchDirs: options.watchDirs ?? [],
		strict: options.strict ?? false,
		minify: options.minify ?? false,
		skipWrite: options.skipWrite ?? false,
		hash: options.hash ?? false,
		manifest: options.manifest ?? `${outFile}${DEFAULT_MANIFEST_SUFFIX}`,
	};
}

/**
 * Thrown by {@link build} when the resolved entry point file does not exist.
 *
 * Callers (including the CLI) can detect this to produce a clean error message
 * without a stack trace.
 */
export class EntryNotFoundError extends Error {
	readonly entryPath: string;
	constructor(entryPath: string) {
		super(`Entry point not found: ${entryPath}`);
		this.name = "EntryNotFoundError";
		this.entryPath = entryPath;
	}
}

/** Current time in HH:MM:SS format (24-hour), for log lines. */
export const timestamp = (): string =>
	new Date().toLocaleTimeString("en-GB", { hour12: false });

type Color = "gray" | "green" | "red" | "cyan";

/**
 * Colors `text` for stderr. `styleText` drops the escape codes when stderr is
 * not a terminal or `NO_COLOR` is set, so piped and CI output stays clean.
 */
export const paint = (color: Color, text: string): string =>
	styleText(color, text, { stream: process.stderr });

/**
 * Writes a timestamped progress line to stderr. Everything but the bundled code
 * (`--skip-write`) goes to stderr, so stdout stays safe to pipe.
 */
export function logLine(message: string, color?: Color): void {
	const body = color ? paint(color, message) : message;
	console.error(`${paint("gray", `[${timestamp()}]`)} ${body}`);
}

/** True when `path` exists and is a regular file. */
export async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/** True when `path` exists (file, directory or anything else). */
export async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Name and version of this package, read from its `package.json` (one level up
 * from both `src/` and the published `dist/`). Null on any error.
 */
export async function getPackageInfo(): Promise<{
	name: string;
	version: string;
} | null> {
	try {
		const url = new URL("../package.json", import.meta.url);
		const json = JSON.parse(await readFile(url, "utf8"));
		return { name: json.name, version: json.version };
	} catch {
		return null;
	}
}
