import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
	computeContentHash,
	emitHashedOutputs,
	insertHashIntoFileName,
} from "../src/hash.ts";
import { listDir, makeProject, read, removeProject } from "./_helpers.ts";

test("insertHashIntoFileName inserts before the extension", () => {
	assert.equal(insertHashIntoFileName("bundle.js", "abc"), "bundle.abc.js");
	assert.equal(insertHashIntoFileName("bundle.min.js", "abc"), "bundle.min.abc.js");
	assert.equal(insertHashIntoFileName("bundle", "abc"), "bundle.abc");
});

test("computeContentHash is deterministic and content-sensitive", async () => {
	const a = await computeContentHash("hello");
	const b = await computeContentHash("hello");
	const c = await computeContentHash("hello!");
	assert.equal(a, b);
	assert.equal(a.length, 8);
	assert.match(a, /^[0-9a-f]{8}$/);
	assert.notEqual(a, c);
	// SHA-256("hello"), first 8 hex chars: same scheme as deno-build
	assert.equal(a, "2cf24dba");
	assert.equal((await computeContentHash("hello", 12)).length, 12);
});

test("emitHashedOutputs writes the hashed copy and the manifest", async () => {
	const dir = await makeProject({});
	const outDir = join(dir, "dist");
	try {
		const res = await emitHashedOutputs({
			outDir,
			outFile: "bundle.js",
			manifest: "m.json",
			code: "A",
		});
		assert.match(res.hashedName, /^bundle\.[0-9a-f]{8}\.js$/);
		assert.equal(res.hashedFile, join(outDir, res.hashedName));
		assert.equal(await read(res.hashedFile), "A");
		assert.deepEqual(JSON.parse(await read(res.manifestFile)), {
			"bundle.js": res.hashedName,
		});
		assert.deepEqual(await listDir(outDir), [res.hashedName, "m.json"].sort());
	} finally {
		await removeProject(dir);
	}
});

test("emitHashedOutputs never deletes a file that is not its own hashed name", async () => {
	const dir = await makeProject({});
	const outDir = join(dir, "dist");
	try {
		await emitHashedOutputs({
			outDir,
			outFile: "bundle.js",
			manifest: "m.json",
			code: "A",
		});
		// A tampered ledger pointing at an unrelated file must not get it removed.
		await writeFile(join(outDir, "important.js"), "keep");
		await writeFile(
			join(outDir, "m.json"),
			JSON.stringify({ "bundle.js": "important.js" }),
		);
		await emitHashedOutputs({
			outDir,
			outFile: "bundle.js",
			manifest: "m.json",
			code: "B",
		});
		await stat(join(outDir, "important.js"));
	} finally {
		await removeProject(dir);
	}
});

test("emitHashedOutputs tolerates a malformed or already-cleaned ledger", async () => {
	const dir = await makeProject({});
	const outDir = join(dir, "dist");
	try {
		await emitHashedOutputs({
			outDir,
			outFile: "bundle.js",
			manifest: "m.json",
			code: "A",
		});
		await writeFile(join(outDir, "m.json"), "{ not json");
		await emitHashedOutputs({
			outDir,
			outFile: "bundle.js",
			manifest: "m.json",
			code: "B",
		});
		// ledger points at a hashed name that is already gone
		await writeFile(
			join(outDir, "m.json"),
			JSON.stringify({ "bundle.js": "bundle.deadbeef.js" }),
		);
		await emitHashedOutputs({
			outDir,
			outFile: "bundle.js",
			manifest: "m.json",
			code: "C",
		});
	} finally {
		await removeProject(dir);
	}
});
