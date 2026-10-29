# CLI Specification

Normative behaviour of `src/cli.ts` and the build it drives. Entry point:
[AGENTS.md](../AGENTS.md).

## Invocation

```bash
npx @marianmeres/bundle [options]     # npm `bundle` bin -> dist/bin.js
bundle [options]                      # installed as a dependency, from package.json scripts
node src/bin.ts [options]             # this repo, from source
```

`src/bin.ts` calls `main()` unconditionally. `main(argv)` is exported from `src/cli.ts`.

## Flags

Parsed by `node:util` `parseArgs` with `strict: true`, `allowPositionals: false`.

| Flag           | Alias | Type     | Default                   |
| -------------- | ----- | -------- | ------------------------- |
| `--root`       | `-r`  | string   | `src`                     |
| `--entry`      | `-e`  | string   | `mod.ts`                  |
| `--outfile`    | `-f`  | string   | `bundle.js`               |
| `--outdir`     | `-o`  | string   | `./dist`                  |
| `--watch`      | `-w`  | boolean  | `false`                   |
| `--watch-dir`  | `-d`  | string[] | `[]` (repeatable)         |
| `--strict`     | `-s`  | boolean  | `false`                   |
| `--minify`     | `-m`  | boolean  | `false`                   |
| `--hash`       |       | boolean  | `false`                   |
| `--manifest`   |       | string   | `<outfile>.manifest.json` |
| `--skip-write` | `-k`  | boolean  | `false`                   |
| `--help`       | `-h`  | boolean  | `false`                   |
| `--esbuild`    | `-b`  | retired  | always an error           |

`--opt=value` and grouped short booleans (`-wm`) work.

## Validation (exit 2, nothing built)

| Condition                     | Message                       |
| ----------------------------- | ----------------------------- |
| Unknown option                | `Unknown option '--x'`        |
| Positional argument           | `Unexpected argument 'x'`     |
| `--esbuild` / `-b`            | `--esbuild was removed: ...`  |
| `--skip-write` with `--watch` | `... cannot be used together` |

`--skip-write` with `--hash`: warning on stderr, hash disabled, exit 0.

## Streams

- **stdout**: `--help` text, or the bundle with `--skip-write` (`console.log(code)`, one
  trailing newline). Nothing else, ever.
- **stderr**: version banner (first line), progress, warnings, errors, esbuild
  diagnostics, tsc diagnostics (tsc's stdout is redirected to fd 2), watch notices.
- Colors via `util.styleText` against stderr: dropped when stderr is not a TTY or
  `NO_COLOR` is set.

## Exit codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| 0    | Success; `--help`                                                    |
| 1    | Build failed: missing entry, type errors, `--strict` setup, bundling |
| 2    | Invalid arguments (table above)                                      |

`main()` sets `process.exitCode`; it never calls `process.exit`, so piped stdout is
flushed.

## Build pipeline (`build()`)

1. Resolve `entry = cwd/root/entry`, `outDir = cwd/outdir`, `outPath = outDir/outfile`.
2. Entry not a regular file → `EntryNotFoundError` (not logged by `build()`; the CLI
   prints `Error: Entry point not found: <path>`).
3. `strict` → `typeCheck()` (below). Failure → `Error("Type checking failed")`.
4. `esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", minify, write:
   false })`; code = `outputFiles[0].text`. Platform/target are esbuild defaults
   (browser, esnext).
5. Unless `skipWrite`: `mkdir -p outDir`, write `outPath`; with `hash`, then
   `emitHashedOutputs()`.
6. Any error in 3–5: logged as `[HH:MM:SS] Build failed: <message>`, rethrown.

## `--strict`

- Config: nearest `tsconfig.json` walking up from the entry's directory. None → error.
- TypeScript: `typescript/package.json` resolved with `createRequire` from the config's
  directory; `bin.tsc` is run as `process.execPath <tsc> -p <temp config>`. Not
  resolvable → error. This package never supplies TypeScript (optional peer dependency).
- Temp config `.tsconfig.bundle-check-<pid>-<n>.json`, written next to the real config:
  `{ extends: "./tsconfig.json", compilerOptions: { noEmit: true, emitDeclarationOnly:
  false, incremental: false, composite: false }, files: [entry], include: [] }`.
  `include: []` stops the base config's `include` from being inherited.
- Cleanup: `finally`, plus SIGINT / SIGTERM / SIGHUP handlers for the duration of the
  check, which remove the file and re-raise the signal when no other listener exists.
- Pass = tsc exit code 0.

## `--watch`

- Initial `build()` runs first; if it fails the CLI exits 1 without watching.
- `fs.watch(dir, { recursive: true })` on `root` and each `--watch-dir`; a missing one is
  an error (exit 1).
- Trigger: changed path ends in `.ts`, `.tsx`, `.js`, `.jsx`, and is not under `outDir`. A
  `null` filename (platform-dependent) triggers.
- 100 ms debounce; serialized rebuilds; changes during a rebuild queue exactly one more.
- A failed rebuild is logged and watching continues; a missing entry is logged as
  `Error: Entry point not found: ...`.
- After every rebuild: `Watching for changes...` on stderr. Runs until killed.

## `--hash`

- Hash: SHA-256 of the final code (post-minify), first 8 lowercase hex chars.
- Writes `outDir/<name>.<hash><ext>` and the manifest `{ "<outfile>": "<hashed>" }`
  (2-space JSON + newline). The stable `outfile` is written too.
- Ledger: the previous manifest's entry is deleted when it differs from the new name and
  matches `^<name>\.[0-9a-f]{8}<ext>$`. Missing or malformed manifest = no previous build.
