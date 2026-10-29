import { parseArgs } from "node:util";
import { build, watchAndRebuild } from "./build.ts";
import {
	type BuildOptions,
	DEFAULT_ENTRY_POINT,
	DEFAULT_OUT_DIR,
	DEFAULT_OUT_FILENAME,
	DEFAULT_ROOT,
	EntryNotFoundError,
	getPackageInfo,
	paint,
} from "./utils.ts";

const USAGE = `
bundle: Bundle TypeScript sources into a single browser-ready ES module.

Usage: npx @marianmeres/bundle [options]

Options:
  --root, -r <path>      Source root directory (default: "${DEFAULT_ROOT}")
  --entry, -e <file>     Entry point file name (default: "${DEFAULT_ENTRY_POINT}")
  --outfile, -f <file>   Output file name (default: "${DEFAULT_OUT_FILENAME}")
  --outdir, -o <path>    Output directory (default: "${DEFAULT_OUT_DIR}")
  --watch, -w            Watch for changes and rebuild automatically
  --watch-dir, -d <path> Additional directory to watch (can be repeated)
  --strict, -s           Type-check the entry with the project's tsc first
  --minify, -m           Minify the output bundle
  --hash                 Also emit a content-hashed copy + manifest (cache-busting)
  --manifest <file>      Manifest file name (default: "<outfile>.manifest.json")
  --skip-write, -k       Print the bundle to stdout instead of writing a file
  --help, -h             Show this help message

Examples:
  npx @marianmeres/bundle
  npx @marianmeres/bundle --root lib --entry index.ts --outfile app.js
  npx @marianmeres/bundle --outdir ./public/js --watch
  npx @marianmeres/bundle --watch --watch-dir ../shared-lib -d ../utils
  npx @marianmeres/bundle --hash --minify

Imports resolve the Node way (node_modules, package.json "imports", tsconfig
"paths"). --strict needs a tsconfig.json at or above the entry's directory and
TypeScript installed in the project.
`;

/** Invalid invocation: message on stderr, exit code 2, nothing built. */
function usageError(message: string): void {
	console.error(paint("red", `Error: ${message}`));
	console.error("Run with --help for usage.");
	process.exitCode = 2;
}

/**
 * Runs the CLI. Sets `process.exitCode` (0 success, 1 build failed, 2 invalid
 * arguments) instead of calling `process.exit`, so buffered stdout is flushed.
 * In watch mode the returned promise does not resolve.
 *
 * @param argv - Arguments without the runtime and script (default: process.argv)
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const pkg = await getPackageInfo();
	if (pkg) console.error(paint("cyan", `${pkg.name} v${pkg.version}`));

	let values: ReturnType<typeof parse>["values"];
	try {
		({ values } = parse(argv));
	} catch (error) {
		return usageError(error instanceof Error ? error.message : String(error));
	}

	if (values.help) {
		console.log(USAGE);
		return;
	}

	if (values.esbuild) {
		return usageError(
			"--esbuild was removed: esbuild is the only bundler now, so drop the flag.",
		);
	}

	const skipWrite = values["skip-write"];

	if (skipWrite && values.watch) {
		return usageError(
			"--skip-write and --watch cannot be used together. Watch mode streams " +
				"rebuilds to a file; --skip-write prints a single build to stdout.",
		);
	}

	// --hash produces files; --skip-write produces none. Rather than error, treat
	// it as a no-op so piping still works — just warn (on stderr) that hashing
	// was ignored.
	let hash = values.hash;
	if (hash && skipWrite) {
		console.error(
			"Warning: --hash is ignored with --skip-write (no files are written).",
		);
		hash = false;
	}

	const options: BuildOptions = {
		root: values.root,
		entry: values.entry,
		outDir: values.outdir,
		outFile: values.outfile,
		watchDirs: values["watch-dir"],
		strict: values.strict,
		minify: values.minify,
		skipWrite,
		hash,
		manifest: values.manifest,
	};

	let code: string;
	try {
		code = await build(options);
	} catch (error) {
		// build() logs every failure itself, except a missing entry
		if (error instanceof EntryNotFoundError) {
			console.error(paint("red", `Error: ${error.message}`));
		}
		process.exitCode = 1;
		return;
	}

	if (skipWrite) {
		console.log(code);
		return;
	}

	if (values.watch) {
		try {
			await watchAndRebuild(options);
		} catch (error) {
			console.error(
				paint("red", `Error: ${error instanceof Error ? error.message : error}`),
			);
			process.exitCode = 1;
		}
	}
}

function parse(argv: string[]) {
	return parseArgs({
		args: argv,
		strict: true,
		allowPositionals: false,
		options: {
			root: { type: "string", short: "r", default: DEFAULT_ROOT },
			entry: { type: "string", short: "e", default: DEFAULT_ENTRY_POINT },
			outfile: { type: "string", short: "f", default: DEFAULT_OUT_FILENAME },
			outdir: { type: "string", short: "o", default: DEFAULT_OUT_DIR },
			watch: { type: "boolean", short: "w", default: false },
			"watch-dir": { type: "string", short: "d", multiple: true, default: [] },
			strict: { type: "boolean", short: "s", default: false },
			minify: { type: "boolean", short: "m", default: false },
			hash: { type: "boolean", default: false },
			manifest: { type: "string" },
			"skip-write": { type: "boolean", short: "k", default: false },
			help: { type: "boolean", short: "h", default: false },
			// retired in the move from deno-build; known only to explain its removal
			esbuild: { type: "boolean", short: "b", default: false },
		},
	});
}
