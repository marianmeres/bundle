import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, mock, test } from "node:test";
import { build } from "../src/build.ts";
import { EntryNotFoundError } from "../src/utils.ts";
import {
	buildOpts,
	listDir,
	makeProject,
	read,
	removeProject,
	TSCONFIG,
} from "./_helpers.ts";

// build() reports progress on stderr; keep the test output readable.
beforeEach(() => {
	mock.method(console, "error", () => {});
});

test("default build writes exactly one file and returns its code", async () => {
	const dir = await makeProject();
	try {
		const code = await build(buildOpts(dir));
		assert.deepEqual(await listDir(join(dir, "dist")), ["bundle.js"]);
		assert.equal(await read(join(dir, "dist", "bundle.js")), code);
		assert.match(code, /export\s*\{\s*x\s*\}/);
	} finally {
		await removeProject(dir);
	}
});

test("bundles relative imports and node_modules packages into one ES module", async () => {
	const dir = await makeProject({
		"src/mod.ts": [
			'import { helper } from "./helper.ts";',
			'import { dep } from "fake-dep";',
			"export const out: string = helper() + dep;",
		].join("\n"),
		"src/helper.ts": 'export const helper = (): string => "HELPER";\n',
		"node_modules/fake-dep/package.json": JSON.stringify({
			name: "fake-dep",
			type: "module",
			exports: "./index.js",
		}),
		"node_modules/fake-dep/index.js": 'export const dep = "DEP";\n',
	});
	try {
		const code = await build(buildOpts(dir));
		assert.match(code, /"HELPER"/);
		assert.match(code, /"DEP"/);
		assert.doesNotMatch(code, /\bimport\b/);
	} finally {
		await removeProject(dir);
	}
});

test("skipWrite returns the code without touching the disk", async () => {
	const dir = await makeProject();
	try {
		const code = await build(buildOpts(dir, { skipWrite: true, hash: true }));
		assert.match(code, /x = 1/);
		await assert.rejects(() => stat(join(dir, "dist")), { code: "ENOENT" });
	} finally {
		await removeProject(dir);
	}
});

test("minify shrinks the output", async () => {
	const src =
		"export function longFunctionName(argumentName: number) {\n\treturn argumentName * 2;\n}\n";
	const dir = await makeProject({ "src/mod.ts": src });
	try {
		const plain = await build(buildOpts(dir, { skipWrite: true }));
		const min = await build(buildOpts(dir, { skipWrite: true, minify: true }));
		assert.ok(min.length < plain.length);
		assert.doesNotMatch(min, /argumentName/);
	} finally {
		await removeProject(dir);
	}
});

test("a missing entry throws EntryNotFoundError", async () => {
	const dir = await makeProject();
	try {
		await assert.rejects(
			() => build(buildOpts(dir, { entry: "nope.ts" })),
			(e: unknown) =>
				e instanceof EntryNotFoundError && e.entryPath.endsWith("nope.ts"),
		);
		// a directory is not an entry either
		await assert.rejects(
			() => build(buildOpts(dir, { entry: "." })),
			EntryNotFoundError,
		);
	} finally {
		await removeProject(dir);
	}
});

test("a bundler error rejects and writes nothing", async () => {
	const dir = await makeProject({ "src/mod.ts": "export const = ;\n" });
	try {
		await assert.rejects(() => build(buildOpts(dir)), /Build failed/);
		await assert.rejects(() => stat(join(dir, "dist")), { code: "ENOENT" });
	} finally {
		await removeProject(dir);
	}
});

test("strict rejects a type error before bundling, and passes clean code", async () => {
	const dir = await makeProject(
		{ "src/mod.ts": 'export const x: number = "nope";\n', "tsconfig.json": TSCONFIG },
		{ linkNodeModules: true },
	);
	try {
		await assert.rejects(
			() => build(buildOpts(dir, { strict: true })),
			/Type checking failed/,
		);
		await assert.rejects(() => stat(join(dir, "dist")), { code: "ENOENT" });

		await writeFile(join(dir, "src", "mod.ts"), "export const x: number = 1;\n");
		await build(buildOpts(dir, { strict: true }));
		await stat(join(dir, "dist", "bundle.js"));
	} finally {
		await removeProject(dir);
	}
});

// ── Content hashing ─────────────────────────────────────────────────────────

test("hash emits stable + hashed + manifest with correct mapping", async () => {
	const dir = await makeProject();
	const dist = join(dir, "dist");
	try {
		const code = await build(buildOpts(dir, { hash: true }));

		const manifest = JSON.parse(await read(join(dist, "bundle.js.manifest.json")));
		const hashedName = manifest["bundle.js"];
		assert.match(hashedName, /^bundle\.[0-9a-f]{8}\.js$/);

		// Stable and hashed files exist, are byte-identical, and match the return value.
		assert.equal(await read(join(dist, "bundle.js")), code);
		assert.equal(await read(join(dist, hashedName)), code);

		assert.deepEqual(
			await listDir(dist),
			["bundle.js", "bundle.js.manifest.json", hashedName].sort(),
		);
	} finally {
		await removeProject(dir);
	}
});

test("hash honors a custom manifest name", async () => {
	const dir = await makeProject();
	const dist = join(dir, "dist");
	try {
		await build(buildOpts(dir, { hash: true, manifest: "assets.json" }));
		const names = await listDir(dist);
		assert.equal(names.includes("assets.json"), true);
		assert.equal(names.includes("bundle.js.manifest.json"), false);
	} finally {
		await removeProject(dir);
	}
});

test("hash cleans the stale hashed file when content changes", async () => {
	const dir = await makeProject();
	const dist = join(dir, "dist");
	const manifest = join(dist, "bundle.js.manifest.json");
	try {
		await build(buildOpts(dir, { hash: true }));
		const first = JSON.parse(await read(manifest))["bundle.js"];

		// An unrelated artifact must survive the cleanup.
		await writeFile(join(dist, "vendor.js"), "/* keep me */\n");

		await writeFile(join(dir, "src", "mod.ts"), "export const x = 999;\n");
		await build(buildOpts(dir, { hash: true }));
		const second = JSON.parse(await read(manifest))["bundle.js"];

		assert.notEqual(first, second);
		// Old hashed file removed, new one present, unrelated file untouched.
		await assert.rejects(() => stat(join(dist, first)), { code: "ENOENT" });
		await stat(join(dist, second));
		await stat(join(dist, "vendor.js"));
	} finally {
		await removeProject(dir);
	}
});
