# Notable Behaviour Changes

Per release, oldest first. Entry point: [AGENTS.md](../AGENTS.md).

## 1.0.0 (from `@marianmeres/deno-build` 2.2.0)

First release under this name: a Node-native port of `deno-build`, published to npm.
`deno-build` stays on JSR for Deno projects. CLI flags, defaults, output layout and
the hash/manifest format are unchanged except as listed.

**Runtime and resolution**

- Runs on Node 24.12+ (`npx @marianmeres/bundle`); no `Deno.*` anywhere.
- Imports resolve the Node way (`node_modules`, `package.json` `imports`, tsconfig
  `paths`). `deno.json` / `import_map.json` discovery is gone, so are `jsr:`, `npm:` and
  URL specifiers.
- esbuild is the only bundler; `@deno/emit` and `@luca/esbuild-deno-loader` are gone.
  Projects that used the former default bundler get esbuild's (equivalent) output.

**CLI**

- `--esbuild` / `-b` is rejected (exit 2) with a message saying to drop it.
- Unknown options and positional arguments are rejected (exit 2); they used to be
  ignored.
- `--strict` runs the project's `tsc` on the entry's import graph with the nearest
  `tsconfig.json` (was `deno check`). Needs TypeScript in the project.
- `Watching for changes...` after a rebuild goes to stderr (was stdout).
- Type-check failures are reported as `Build failed: Type checking failed`, exit 1,
  without a stack trace.
- In watch mode a deleted or renamed entry is logged (was silently ignored).
- Colors follow stderr's TTY state and `NO_COLOR` (was stdout's TTY state).

**Library** (`jsr:@marianmeres/deno-build/lib` → `@marianmeres/bundle`)

- Removed: the `./esbuild` sub-export (`buildWithEsbuild`, `minifyCode`, `stopEsbuild`,
  `EsbuildOptions`); `BuildOptions.useEsbuild` and `keepEsbuildAlive` (Node's esbuild
  service does not keep the process alive); `findImportMap`, `logStyled`,
  `supportsColor`, `timestamp`, `getPackageInfo`, `PackageInfo`.
- `watchAndRebuild()` accepts `signal` (`WatchOptions`) and returns `Promise<void>`
  that resolves on abort (was `Promise<never>`).
- `typeCheck(entryPath, tsconfigPath?)` gained the optional config path; new
  `findTsconfig()`.
- An entry that is a directory now throws `EntryNotFoundError`.
