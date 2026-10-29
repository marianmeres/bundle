# @marianmeres/bundle

[![NPM](https://img.shields.io/npm/v/@marianmeres/bundle)](https://www.npmjs.com/package/@marianmeres/bundle)
[![License](https://img.shields.io/npm/l/@marianmeres/bundle)](LICENSE)

A small CLI and library that bundles a TypeScript entry point and everything it imports
into a single browser-ready ES module, ready for `<script type="module">`. Built on
esbuild, with an optional type check, watch mode and content-hashed output for
cache-busting.

It is the Node successor of
[`@marianmeres/deno-build`](https://jsr.io/@marianmeres/deno-build): same flags, same
defaults, same output layout. `deno-build` stays the tool for Deno projects.

## Installation

```bash
# Run without installing
npx @marianmeres/bundle

# Or add it to a project and call `bundle` from package.json scripts
pnpm add -D @marianmeres/bundle
```

Requires Node 24.12+. pnpm may report that it skipped esbuild's build script; esbuild
works without it, so you can deny it (`pnpm approve-builds '!esbuild'`).

## CLI usage

```bash
# Bundle src/mod.ts -> dist/bundle.js (defaults)
npx @marianmeres/bundle

# Custom paths
npx @marianmeres/bundle --root lib --entry index.ts --outfile app.js --outdir ./public/js

# Watch mode, also watching a sibling library
npx @marianmeres/bundle --watch --watch-dir ../shared-lib

# Type-check first, minify, emit a content-hashed copy + manifest
npx @marianmeres/bundle --strict --minify --hash

# Print the bundle to stdout instead of writing a file
npx @marianmeres/bundle --skip-write > bundle.js
```

| Option         | Alias | Default                   | Description                                         |
| -------------- | ----- | ------------------------- | --------------------------------------------------- |
| `--root`       | `-r`  | `src`                     | Source root directory                               |
| `--entry`      | `-e`  | `mod.ts`                  | Entry point file name (within root)                 |
| `--outfile`    | `-f`  | `bundle.js`               | Output file name                                    |
| `--outdir`     | `-o`  | `./dist`                  | Output directory                                    |
| `--watch`      | `-w`  | `false`                   | Rebuild when sources change                         |
| `--watch-dir`  | `-d`  |                           | Additional directory to watch (repeatable)          |
| `--strict`     | `-s`  | `false`                   | Type-check the entry with the project's `tsc` first |
| `--minify`     | `-m`  | `false`                   | Minify the output                                   |
| `--hash`       |       | `false`                   | Also emit a content-hashed copy + manifest          |
| `--manifest`   |       | `<outfile>.manifest.json` | Manifest file name (with `--hash`)                  |
| `--skip-write` | `-k`  | `false`                   | Print the bundle to stdout, write nothing           |
| `--help`       | `-h`  |                           | Show help                                           |

Paths are relative to the current directory. Imports resolve the way Node resolves them:
relative files, packages in `node_modules`, `package.json` `"imports"` and tsconfig
`"paths"`.

**Output streams.** Progress, warnings and errors go to stderr. Stdout carries only the
bundle, and only with `--skip-write`, so piping is safe.

**Exit codes.** `0` success, `1` build failed (missing entry, type errors, bundler
errors), `2` invalid arguments (unknown option, positional argument, `--skip-write` with
`--watch`). `--hash` with `--skip-write` only warns: no files are written, so there is
nothing to hash.

## Type checking (`--strict`)

`--strict` runs the project's own TypeScript (`tsc` from its `node_modules`) over the
entry point and the files it imports, and fails the build on any type error. It uses the
**nearest `tsconfig.json`** at or above the entry's directory, so an example or demo
folder can carry its own config, for instance one that adds the DOM lib:

```jsonc
// example/tsconfig.json — picked for --root example/src
{
	"extends": "../tsconfig.json",
	"compilerOptions": { "lib": ["es2024", "dom"], "types": [] },
	"include": ["src"]
}
```

Only the entry's import graph is checked, not everything the config `include`s. Install
TypeScript in the project (`pnpm add -D typescript`); this package does not bring one.

## Content hashing & cache-busting

With `--hash` the build writes three files instead of one:

```
dist/
├── bundle.js                  # stable name, as without --hash
├── bundle.a1b2c3d4.js         # same bytes, content-hashed name
└── bundle.js.manifest.json    # { "bundle.js": "bundle.a1b2c3d4.js" }
```

- The hash is the first 8 hex chars of the SHA-256 of the final bytes (after `--minify`).
- A server or template step reads the manifest to resolve the cache-busted URL and can
  then serve it with an immutable `Cache-Control`.
- The manifest is also a cleanup ledger: when the content changes, the previous hashed
  file is removed, so `--watch` does not pile up stale copies. Only files matching
  `<name>.<8 hex>.<ext>` are ever deleted.

## Library usage

```typescript
import { build, EntryNotFoundError } from "@marianmeres/bundle";

// Same defaults as the CLI: src/mod.ts -> ./dist/bundle.js
await build();

// Options mirror the CLI flags; build() returns the bundled code
const code = await build({ root: "lib", entry: "index.ts", minify: true, hash: true });

// Code only, nothing written
const inMemory = await build({ skipWrite: true });

try {
	await build({ entry: "typo.ts" });
} catch (e) {
	if (e instanceof EntryNotFoundError)
		console.error(`Nothing to build: ${e.entryPath}`);
	else throw e;
}
```

See [API.md](API.md) for the full API.

## Migrating from `@marianmeres/deno-build`

Swap the command prefix; flags and defaults are unchanged:

```diff
- deno run -A jsr:@marianmeres/deno-build --root example/src --outdir example/dist --strict
+ npx @marianmeres/bundle --root example/src --outdir example/dist --strict
```

What differs:

- Sources resolve the Node way. `jsr:`, `npm:` and URL imports and `deno.json` import
  maps are not read; dependencies come from `node_modules`.
- esbuild is the only bundler. `--esbuild` / `-b` is rejected with exit code 2; drop it.
- `--strict` runs the project's `tsc` against the nearest `tsconfig.json` instead of
  `deno check`, and needs TypeScript installed in the project.
- Unknown options and positional arguments are errors (exit 2) instead of being ignored.
- The hash scheme and manifest format are the same, so code reading manifests keeps
  working.

Library and behaviour changes are listed in [docs/changes.md](docs/changes.md).

## Development

Node LTS (`.node-version`), pnpm, Biome, `node:test`. The source is erasable-only
TypeScript that Node runs directly; `dist/` is built only for publishing.

| Command                             | Does                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pnpm install`                      | installs esbuild and the dev tooling                                   |
| `pnpm test` / `pnpm run test:watch` | `node --test` over `tests/**/*.test.ts`                                |
| `pnpm run typecheck`                | `tsc --noEmit` over `src` and `tests`                                  |
| `pnpm run lint`                     | `biome check .` — format, lint and import order, read-only             |
| `pnpm run format`                   | `biome check --write .` — fixes all of the above                       |
| `pnpm run ci`                       | typecheck + lint + test, what CI runs                                  |
| `pnpm run example`                  | bundles `example/src` (with `--strict`); open `example/example.html`   |
| `pnpm run build`                    | `tsc -p tsconfig.build.json` → `dist/`                                 |
| `pnpm run release`                  | bump, commit, tag, push (`@marianmeres/release` via npx)               |
| `pnpm run rp` / `pnpm run rpm`      | patch / minor release, then `pnpm publish` (which runs `ci` + `build`) |

## License

[MIT](./LICENSE)
