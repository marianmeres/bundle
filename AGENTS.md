# @marianmeres/bundle — Agent Guide

## Quick Reference

- **What**: CLI + library. Bundles a TS entry and its imports into one browser ES module
  with esbuild; optional `tsc` check (`--strict`), watch mode, content-hashed copy +
  manifest (`--hash`). Node successor of `@marianmeres/deno-build` (same flags/defaults).
- **Stack**: TypeScript (erasable-only), Node LTS (`.node-version`), pnpm, `node:test`,
  Biome. Runtime dependency: `esbuild`. Optional peer: `typescript`.
- **Install**: `pnpm install` | **Test**: `pnpm test` | **Check all**: `pnpm run ci` |
  **Build**: `pnpm run build` | **Demo**: `pnpm run example`
- **Distribution**: npm only (`bundle` bin: `npx @marianmeres/bundle`). No JSR.

## Project Structure

```
src/bin.ts         npm `bin` entry; calls main() unconditionally
src/cli.ts         main(argv): parseArgs, validation, exit codes
src/build.ts       build(), watchAndRebuild()
src/typecheck.ts   typeCheck(), findTsconfig() — project tsc via a temp extending config
src/hash.ts        computeContentHash(), insertHashIntoFileName(), emitHashedOutputs()
src/utils.ts       BuildOptions, defaults, EntryNotFoundError, stderr logging helpers
src/index.ts       library entry ("exports"); explicit re-exports only
tests/             node:test suites; _helpers.ts builds temp fixture projects
example/           demo sources + own tsconfig (DOM lib); example/dist is gitignored
docs/cli.md        normative CLI + pipeline spec
docs/changes.md    behaviour changes per release (incl. the delta from deno-build)
```

## Critical Conventions

1. **Runtime policy**: Node at the keyboard and in production, npm as the registry. No
   `Deno.*`, `Bun.*`, `jsr:` or `npm:` specifiers; web standards first, `node:*` else.
2. **Erasable TypeScript**: no `enum`, `namespace`, parameter properties; `import type`;
   explicit `.ts` import extensions. `pnpm run typecheck` is the only type gate.
3. **Stdout is reserved** for `--help` and the `--skip-write` bundle. Every log line goes
   to stderr (`logLine` / `paint` in utils.ts); child `tsc` output is redirected to fd 2.
4. **Library paths never exit**: they throw. Only `main()` sets `process.exitCode`
   (0 / 1 build failed / 2 invalid args); never `process.exit`.
5. **TypeScript comes from the consumer project**, resolved from the tsconfig's
   directory; never import `typescript` here. The temp config must sit next to the real
   one (directory-relative settings) and be removed on signals too.
6. **CLI compatibility with deno-build** is a feature: keep flags, defaults, hash scheme
   and manifest format; a removed flag gets a specific error, not a silent no-op.
7. **Formatting**: tabs, 4 wide, 90 columns (`biome.json`). `pnpm run format` first.
8. **Releasing is a human action**: `pnpm run rp` / `rpm` (bump, commit, tag, push via
   `@marianmeres/release`, then `pnpm publish`, which runs `ci` + `build`).

## Before Making Changes

- [ ] Behaviour change: update [docs/cli.md](./docs/cli.md), add a test, note it in
  [docs/changes.md](./docs/changes.md)
- [ ] New flag: `parse()` + `USAGE` in cli.ts, `BuildOptions`, README options table
- [ ] Watch tests must stop the watcher in `t.after` (a live watcher hangs the run)
- [ ] `pnpm run ci`

## Documentation Index

- [README.md](./README.md): human-facing docs, migration from deno-build
- [API.md](./API.md): library API
- [docs/cli.md](./docs/cli.md): CLI specification
- [docs/changes.md](./docs/changes.md): notable behaviour changes
