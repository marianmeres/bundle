# API

Everything below is exported from `@marianmeres/bundle`. The CLI is a thin layer over
`build()` and `watchAndRebuild()`.

## Functions

### `build(options?)`

Bundles `root/entry` and its imports into one ES module with esbuild (`bundle: true`,
`format: "esm"`, browser platform). Paths resolve against `process.cwd()`. Writes the
output unless `skipWrite`, and with `hash` also the hashed copy and manifest. Progress
goes to stderr; failures are logged (`Build failed: ...`) and rethrown.

**Parameters:**

- `options` ([`BuildOptions`](#buildoptions), optional) — all fields optional.

**Returns:** `Promise<string>` — the bundled code (the same with or without `hash`).

**Throws:** [`EntryNotFoundError`](#entrynotfounderror) when the entry file does not
exist; `Error("Type checking failed")` on type errors with `strict`; the esbuild error
when bundling fails.

```typescript
const code = await build({ root: "example/src", outDir: "example/dist", strict: true });
```

---

### `watchAndRebuild(options?)`

Watches `root` and every `watchDirs` entry recursively and calls `build()` on changes to
`.ts`, `.tsx`, `.js` and `.jsx` files. Rebuilds are debounced (100 ms) and serialized:
changes during a rebuild queue exactly one follow-up. Writes under `outDir` never trigger
a rebuild. A failing rebuild is logged and watching continues. Does not build up front:
call `build()` first.

**Parameters:**

- `options` ([`WatchOptions`](#watchoptions), optional) — build options plus `signal`.

**Returns:** `Promise<void>` — resolves once `signal` aborts and any in-flight rebuild has
finished. Without a signal it never resolves.

**Throws:** when a watched directory does not exist, or a watcher fails.

```typescript
const ac = new AbortController();
await build(opts);
const watching = watchAndRebuild({ ...opts, signal: ac.signal });
// later
ac.abort();
await watching;
```

---

### `typeCheck(entryPath, tsconfigPath?)`

Type-checks the import graph of `entryPath` with the TypeScript installed in the project
(resolved from the config's directory). Writes a temporary config next to `tsconfigPath`
that extends it with `files: [entry]`, `include: []` and `noEmit`, runs `tsc -p` on it and
removes it, also on SIGINT / SIGTERM / SIGHUP. Diagnostics go to stderr.

**Parameters:**

- `entryPath` (string) — absolute path of the entry file.
- `tsconfigPath` (string, optional) — config to extend. Default: `findTsconfig()` from the
  entry's directory.

**Returns:** `Promise<boolean>` — `true` when the check passes.

**Throws:** when no `tsconfig.json` is found, or TypeScript is not resolvable.

---

### `findTsconfig(startDir)`

**Returns:** `Promise<string | undefined>` — absolute path of the nearest `tsconfig.json`
at or above `startDir`.

---

### `computeContentHash(code, len?)`

SHA-256 of `code` (UTF-8) via Web Crypto, truncated.

**Parameters:**

- `code` (string) — the exact text written to disk.
- `len` (number, optional) — hex characters to keep. Default: `DEFAULT_HASH_LENGTH` (8).

**Returns:** `Promise<string>` — lowercase hex.

---

### `insertHashIntoFileName(fileName, hash)`

`bundle.js` → `bundle.<hash>.js`. Only the last extension counts (`bundle.min.js` →
`bundle.min.<hash>.js`); a name without one gets the hash appended.

**Returns:** `string`

---

### `emitHashedOutputs(options)`

Writes `outDir/<hashed name>` and the manifest `{ [outFile]: hashedName }`. Reads the
previous manifest first and deletes the old hashed file when the name changed and it
matches `<name>.<hex>.<ext>`. Does not write the stable `outFile` (`build()` does).

**Parameters:**

- `options` ([`EmitHashedOutputsOptions`](#emithashedoutputsoptions))

**Returns:** `Promise<EmitHashedOutputsResult>`

---

### `resolveBuildOptions(options?)`

Fills in defaults. **Returns:** [`ResolvedBuildOptions`](#resolvedbuildoptions).

## Classes

### `EntryNotFoundError`

Extends `Error`; `name` is `"EntryNotFoundError"`, `entryPath` holds the resolved path.

## Types

### `BuildOptions`

```typescript
interface BuildOptions {
	root?: string; // "src"
	entry?: string; // "mod.ts"
	outDir?: string; // "./dist"
	outFile?: string; // "bundle.js"
	watchDirs?: string[]; // [] (watch mode only)
	strict?: boolean; // false — typeCheck() before bundling
	minify?: boolean; // false
	skipWrite?: boolean; // false — return the code, write nothing
	hash?: boolean; // false — ignored with skipWrite
	manifest?: string; // `${outFile}.manifest.json`
}
```

### `WatchOptions`

```typescript
interface WatchOptions extends BuildOptions {
	signal?: AbortSignal;
}
```

### `ResolvedBuildOptions`

`BuildOptions` with every field required.

### `EmitHashedOutputsOptions`

```typescript
interface EmitHashedOutputsOptions {
	outDir: string; // absolute
	outFile: string; // logical name, e.g. "bundle.js"
	manifest: string; // file name within outDir
	code: string;
}
```

### `EmitHashedOutputsResult`

```typescript
interface EmitHashedOutputsResult {
	hashedFile: string; // absolute
	manifestFile: string; // absolute
	hashedName: string; // e.g. "bundle.a1b2c3d4.js"
}
```

## Constants

| Name                      | Value              |
| ------------------------- | ------------------ |
| `DEFAULT_ROOT`            | `"src"`            |
| `DEFAULT_ENTRY_POINT`     | `"mod.ts"`         |
| `DEFAULT_OUT_FILENAME`    | `"bundle.js"`      |
| `DEFAULT_OUT_DIR`         | `"./dist"`         |
| `DEFAULT_MANIFEST_SUFFIX` | `".manifest.json"` |
| `DEFAULT_HASH_LENGTH`     | `8`                |
