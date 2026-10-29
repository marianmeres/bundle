import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mock, type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { build, watchAndRebuild } from "../src/build.ts";
import {
	buildOpts,
	listDir,
	makeProject,
	read,
	removeProject,
	waitFor,
} from "./_helpers.ts";

/** Silences stderr progress and counts the "Building ..." lines. */
function countBuilds(): () => number {
	const spy = mock.method(console, "error", () => {});
	return () =>
		spy.mock.calls.filter((c) => String(c.arguments[0] ?? "").includes("Building"))
			.length;
}

/**
 * Builds once, starts watching and registers cleanup: the watcher is stopped
 * and the fixture removed even when an assertion fails mid-test (a watcher
 * left running would keep the test process alive).
 */
async function startWatching(
	t: TestContext,
	dir: string,
	opts: ReturnType<typeof buildOpts>,
): Promise<{ stop: () => Promise<void> }> {
	const ac = new AbortController();
	await build(opts);
	const watching = watchAndRebuild({ ...opts, signal: ac.signal });
	const stop = async () => {
		ac.abort();
		await watching;
	};
	t.after(async () => {
		await stop();
		await removeProject(dir);
	});
	await delay(300); // let the watchers settle (macOS may replay recent events)
	return { stop };
}

test("rebuilds on a source change, ignores its own output, stops on abort", async (t) => {
	const builds = countBuilds();
	const dir = await makeProject();
	const bundle = join(dir, "dist", "bundle.js");
	// Watching the whole project puts outDir inside a watched dir: without the
	// outDir filter, every write of the bundle would trigger the next rebuild.
	const { stop } = await startWatching(
		t,
		dir,
		buildOpts(dir, { watchDirs: [dir], hash: true }),
	);

	const before = builds();
	await writeFile(join(dir, "src", "mod.ts"), "export const x = 2;\n");
	await waitFor(async () => (await read(bundle)).includes("x = 2"));
	await delay(700); // a feedback loop would rebuild every ~100ms in this window
	const rebuilds = builds() - before;
	assert.ok(rebuilds >= 1 && rebuilds <= 2, `expected 1-2 rebuilds, got ${rebuilds}`);

	// the ledger kept exactly one hashed copy across rebuilds
	const names = await listDir(join(dir, "dist"));
	assert.equal(names.filter((n) => /^bundle\.[0-9a-f]{8}\.js$/.test(n)).length, 1);

	await stop();
	await writeFile(join(dir, "src", "mod.ts"), "export const x = 3;\n");
	await delay(400);
	assert.match(await read(bundle), /x = 2/);
});

test("a burst of changes is debounced into few rebuilds ending on the last state", async (t) => {
	const builds = countBuilds();
	const dir = await makeProject();
	const bundle = join(dir, "dist", "bundle.js");
	await startWatching(t, dir, buildOpts(dir));

	const before = builds();
	for (let i = 10; i <= 15; i++) {
		await writeFile(join(dir, "src", "mod.ts"), `export const x = ${i};\n`);
		await delay(10);
	}
	await waitFor(async () => (await read(bundle)).includes("x = 15"));
	await delay(300);
	const rebuilds = builds() - before;
	assert.ok(rebuilds >= 1 && rebuilds <= 2, `expected 1-2 rebuilds, got ${rebuilds}`);
});

test("only source extensions trigger a rebuild", async (t) => {
	const builds = countBuilds();
	const dir = await makeProject();
	await startWatching(t, dir, buildOpts(dir));

	const before = builds();
	await writeFile(join(dir, "src", "notes.md"), "# not a source file\n");
	await delay(400);
	assert.equal(builds() - before, 0);
});

test("a missing watch directory rejects before watching", async (t) => {
	countBuilds();
	const dir = await makeProject();
	t.after(() => removeProject(dir));
	await assert.rejects(
		() => watchAndRebuild(buildOpts(dir, { watchDirs: [join(dir, "nope")] })),
		/Watch directory does not exist/,
	);
});
