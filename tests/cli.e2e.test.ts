// End-to-end: spawn the CLI (src/bin.ts on Node) inside throwaway projects and
// check the stream contract, exit codes and files written.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeProject, read, removeProject, TSCONFIG } from "./_helpers.ts";

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url));

interface Run {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

/**
 * Runs the CLI in `cwd`. With `interruptOn`, sends SIGINT to the CLI's whole
 * process group (like Ctrl+C in a terminal) once stderr contains that text.
 */
function cli(cwd: string, args: string[], interruptOn?: string): Promise<Run> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [BIN, ...args], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			detached: interruptOn !== undefined,
		});
		let stdout = "";
		let stderr = "";
		let interrupted = false;
		child.stdout.setEncoding("utf8").on("data", (s: string) => (stdout += s));
		child.stderr.setEncoding("utf8").on("data", (s: string) => {
			stderr += s;
			if (
				interruptOn &&
				!interrupted &&
				stderr.includes(interruptOn) &&
				child.pid
			) {
				interrupted = true;
				process.kill(-child.pid, "SIGINT");
			}
		});
		child.on("error", reject);
		child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
	});
}

const exists = (path: string) =>
	stat(path).then(
		() => true,
		() => false,
	);

test("--help prints usage on stdout and exits 0", async () => {
	const dir = await makeProject();
	try {
		const r = await cli(dir, ["--help"]);
		assert.equal(r.code, 0);
		assert.match(r.stdout, /Usage: npx @marianmeres\/bundle/);
		assert.match(r.stderr, /@marianmeres\/bundle v/);
		assert.equal(await exists(join(dir, "dist")), false);
	} finally {
		await removeProject(dir);
	}
});

test("defaults: src/mod.ts -> dist/bundle.js, nothing on stdout", async () => {
	const dir = await makeProject();
	try {
		const r = await cli(dir, []);
		assert.equal(r.code, 0, r.stderr);
		assert.equal(r.stdout, "");
		assert.match(r.stderr, /✓ dist\/bundle\.js/);
		assert.match(await read(join(dir, "dist", "bundle.js")), /x = 1/);
	} finally {
		await removeProject(dir);
	}
});

test("--skip-write prints only the bundle on stdout and writes nothing", async () => {
	const dir = await makeProject();
	try {
		const r = await cli(dir, ["--skip-write"]);
		assert.equal(r.code, 0, r.stderr);
		assert.match(
			r.stdout,
			/^\/\/ src\/mod\.ts\nvar x = 1;\nexport \{\n {2}x\n\};\n\n$/,
		);
		assert.match(r.stderr, /Building src\/mod\.ts/);
		assert.equal(await exists(join(dir, "dist")), false);
	} finally {
		await removeProject(dir);
	}
});

test("--skip-write --strict keeps tsc diagnostics off stdout", async () => {
	const dir = await makeProject(
		{ "src/mod.ts": 'export const x: number = "nope";\n', "tsconfig.json": TSCONFIG },
		{ linkNodeModules: true },
	);
	try {
		const r = await cli(dir, ["-k", "-s"]);
		assert.equal(r.code, 1);
		assert.equal(r.stdout, "");
		assert.match(r.stderr, /TS2322/);
		assert.match(r.stderr, /Build failed: Type checking failed/);
	} finally {
		await removeProject(dir);
	}
});

test("custom root/entry/outdir/outfile, --minify and --hash", async () => {
	const dir = await makeProject({ "lib/app.ts": "export const answer = 40 + 2;\n" });
	try {
		const r = await cli(dir, [
			"-r",
			"lib",
			"-e",
			"app.ts",
			"-o",
			"public/js",
			"-f",
			"app.js",
			"-m",
			"--hash",
			"--manifest",
			"assets.json",
		]);
		assert.equal(r.code, 0, r.stderr);
		const out = join(dir, "public", "js");
		const manifest = JSON.parse(await read(join(out, "assets.json")));
		assert.match(manifest["app.js"], /^app\.[0-9a-f]{8}\.js$/);
		const stable = await read(join(out, "app.js"));
		assert.equal(await read(join(out, manifest["app.js"])), stable);
		assert.ok(!stable.includes("\n  "), "expected minified output");
	} finally {
		await removeProject(dir);
	}
});

test("invalid invocations exit 2 and build nothing", async () => {
	const dir = await makeProject();
	try {
		const cases: [string[], RegExp][] = [
			[["--skip-write", "--watch"], /cannot be used together/],
			[["--minfy"], /Unknown option '--minfy'/],
			[["src/mod.ts"], /Unexpected argument/],
			[["--esbuild"], /--esbuild was removed/],
			[["-b"], /--esbuild was removed/],
		];
		for (const [args, message] of cases) {
			const r = await cli(dir, args);
			assert.equal(r.code, 2, args.join(" "));
			assert.match(r.stderr, message);
			assert.equal(r.stdout, "");
		}
		assert.equal(await exists(join(dir, "dist")), false);
	} finally {
		await removeProject(dir);
	}
});

test("--hash with --skip-write warns and is ignored", async () => {
	const dir = await makeProject();
	try {
		const r = await cli(dir, ["-k", "--hash"]);
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stderr, /--hash is ignored with --skip-write/);
		assert.equal(await exists(join(dir, "dist")), false);
	} finally {
		await removeProject(dir);
	}
});

test("a missing entry exits 1 with a clean message", async () => {
	const dir = await makeProject();
	try {
		const r = await cli(dir, ["-e", "nope.ts"]);
		assert.equal(r.code, 1);
		assert.match(r.stderr, /Error: Entry point not found: .*nope\.ts/);
		assert.doesNotMatch(r.stderr, /\n\s+at /); // no stack trace
	} finally {
		await removeProject(dir);
	}
});

test("Ctrl+C during --strict removes the temp tsconfig and still terminates", async () => {
	// A stand-in `tsc` that announces itself and then hangs, so the interrupt
	// is guaranteed to land while the check is running.
	const dir = await makeProject({
		"src/mod.ts": "export const x = 1;\n",
		"tsconfig.json": TSCONFIG,
		"node_modules/typescript/package.json": JSON.stringify({
			name: "typescript",
			version: "0.0.0-fake",
			bin: { tsc: "bin/tsc.js" },
		}),
		"node_modules/typescript/bin/tsc.js":
			'console.log("FAKE_TSC_RUNNING");\nsetTimeout(() => {}, 10000);\n',
	});
	try {
		const r = await cli(dir, ["--strict"], "FAKE_TSC_RUNNING");
		assert.equal(r.signal, "SIGINT");
		const leftovers = (await readdir(dir)).filter((n) => n.includes("bundle-check"));
		assert.deepEqual(leftovers, []);
		assert.equal(await exists(join(dir, "dist")), false);
	} finally {
		await removeProject(dir);
	}
});
