import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { findTsconfig, typeCheck } from "../src/typecheck.ts";
import { listDir, makeProject, read, removeProject, TSCONFIG } from "./_helpers.ts";

const BROWSER_TSCONFIG = JSON.stringify({
	extends: "../tsconfig.json",
	compilerOptions: { lib: ["es2024", "dom"] },
});

test("findTsconfig returns the nearest tsconfig.json", async () => {
	const dir = await makeProject({
		"tsconfig.json": TSCONFIG,
		"example/tsconfig.json": BROWSER_TSCONFIG,
		"example/src/main.ts": "",
		"src/mod.ts": "",
	});
	try {
		assert.equal(
			await findTsconfig(join(dir, "example", "src")),
			join(dir, "example", "tsconfig.json"),
		);
		assert.equal(await findTsconfig(join(dir, "src")), join(dir, "tsconfig.json"));
	} finally {
		await removeProject(dir);
	}
});

test("typeCheck passes clean code and fails a type error", async () => {
	const dir = await makeProject(
		{
			"tsconfig.json": TSCONFIG,
			"src/ok.ts": 'import { b } from "./b.ts";\nexport const a: number = b;\n',
			"src/b.ts": "export const b = 1;\n",
			"src/bad.ts": 'export const a: number = "nope";\n',
		},
		{ linkNodeModules: true },
	);
	try {
		assert.equal(await typeCheck(join(dir, "src", "ok.ts")), true);
		assert.equal(await typeCheck(join(dir, "src", "bad.ts")), false);
	} finally {
		await removeProject(dir);
	}
});

test("typeCheck checks the entry's graph only, not the config's include", async () => {
	const dir = await makeProject(
		{
			"tsconfig.json": JSON.stringify({
				...JSON.parse(TSCONFIG),
				include: ["src"],
			}),
			"src/mod.ts": "export const x: number = 1;\n",
			// included by the config, never imported by the entry
			"src/broken.ts": 'export const y: number = "nope";\n',
		},
		{ linkNodeModules: true },
	);
	try {
		assert.equal(await typeCheck(join(dir, "src", "mod.ts")), true);
		// and the graph is followed: importing it makes the check fail
		await writeFile(join(dir, "src", "mod.ts"), 'export { y } from "./broken.ts";\n');
		assert.equal(await typeCheck(join(dir, "src", "mod.ts")), false);
	} finally {
		await removeProject(dir);
	}
});

test("typeCheck uses the nearest config (a DOM lib in example/)", async () => {
	const dir = await makeProject(
		{
			"tsconfig.json": TSCONFIG,
			"example/tsconfig.json": BROWSER_TSCONFIG,
			"example/src/main.ts":
				'export const el: HTMLElement = document.createElement("p");\n',
		},
		{ linkNodeModules: true },
	);
	const entry = join(dir, "example", "src", "main.ts");
	try {
		assert.equal(await typeCheck(entry), true);
		// the same entry against the root config (no DOM) fails
		assert.equal(await typeCheck(entry, join(dir, "tsconfig.json")), false);
	} finally {
		await removeProject(dir);
	}
});

test("typeCheck leaves no temp config behind", async () => {
	const dir = await makeProject(
		{
			"tsconfig.json": TSCONFIG,
			"src/ok.ts": "export const a = 1;\n",
			"src/bad.ts": 'export const a: number = "nope";\n',
		},
		{ linkNodeModules: true },
	);
	try {
		const before = await listDir(dir);
		await typeCheck(join(dir, "src", "ok.ts"));
		await typeCheck(join(dir, "src", "bad.ts"));
		assert.deepEqual(await listDir(dir), before);
	} finally {
		await removeProject(dir);
	}
});

test("typeCheck throws without a tsconfig.json", async () => {
	const dir = await makeProject({ "src/mod.ts": "export const a = 1;\n" });
	try {
		await assert.rejects(
			() => typeCheck(join(dir, "src", "mod.ts")),
			/needs a tsconfig\.json/,
		);
	} finally {
		await removeProject(dir);
	}
});

test("typeCheck throws when TypeScript is not installed", async () => {
	// no linked node_modules: typescript does not resolve from the fixture
	const dir = await makeProject({ "tsconfig.json": TSCONFIG, "src/mod.ts": "" });
	try {
		await assert.rejects(
			() => typeCheck(join(dir, "src", "mod.ts")),
			/needs TypeScript installed/,
		);
	} finally {
		await removeProject(dir);
	}
});

test("typeCheck runs the project's tsc on a config narrowed to the entry", async () => {
	// A stand-in `tsc` that records how it was called and what config it got.
	const recorder = [
		'import { readFileSync, writeFileSync } from "node:fs";',
		"const p = process.argv.indexOf('-p');",
		"const configPath = process.argv[p + 1];",
		"const config = JSON.parse(readFileSync(configPath, 'utf8'));",
		"writeFileSync(new URL('../../../call.json', import.meta.url), JSON.stringify({ configPath, config }));",
		"process.exit(3);",
	].join("\n");
	const dir = await makeProject({
		"tsconfig.json": TSCONFIG,
		"src/mod.ts": "",
		"node_modules/typescript/package.json": JSON.stringify({
			name: "typescript",
			type: "module",
			bin: { tsc: "bin/tsc.js" },
		}),
		"node_modules/typescript/bin/tsc.js": recorder,
	});
	const entry = join(dir, "src", "mod.ts");
	try {
		// a non-zero tsc exit is a failed check
		assert.equal(await typeCheck(entry), false);
		const { configPath, config } = JSON.parse(await read(join(dir, "call.json")));
		// next to the real config, so directory-relative settings resolve the same
		assert.equal(dirname(configPath), dir);
		assert.deepEqual(config, {
			extends: "./tsconfig.json",
			compilerOptions: {
				noEmit: true,
				emitDeclarationOnly: false,
				incremental: false,
				composite: false,
			},
			files: [entry],
			include: [],
		});
	} finally {
		await removeProject(dir);
	}
});
