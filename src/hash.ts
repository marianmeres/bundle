import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";

/**
 * Length (in hex characters) of the content hash inserted into output file
 * names. Eight hex chars = 32 bits, which is ample for cache-busting a handful
 * of build artifacts while keeping the filename short.
 */
export const DEFAULT_HASH_LENGTH = 8;

/**
 * Computes a short hex content hash of the given code using SHA-256.
 *
 * Uses the Web Crypto API (`crypto.subtle`), so it pulls in no dependencies.
 * The full digest is truncated to `len` hex chars.
 *
 * @param code - The exact text whose bytes should be hashed (e.g. the final,
 *   post-minify bundle). Hash the same bytes you write to disk.
 * @param len - Number of leading hex characters to keep (default
 *   {@link DEFAULT_HASH_LENGTH}).
 * @returns Lowercase hex string of length `len`.
 */
export async function computeContentHash(
	code: string,
	len: number = DEFAULT_HASH_LENGTH,
): Promise<string> {
	const bytes = new TextEncoder().encode(code);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const hex = Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return hex.slice(0, len);
}

/**
 * Inserts a hash segment before the file extension.
 *
 * `insertHashIntoFileName("bundle.js", "a1b2c3d4")` → `"bundle.a1b2c3d4.js"`.
 * Only the final extension is treated as the extension, so `bundle.min.js`
 * becomes `bundle.min.a1b2c3d4.js`. Names without an extension get the hash
 * appended: `bundle` → `bundle.a1b2c3d4`.
 *
 * @param fileName - Base output file name (no directory component expected).
 * @param hash - Hash segment to insert.
 * @returns The hashed file name.
 */
export function insertHashIntoFileName(fileName: string, hash: string): string {
	const { name, ext } = parse(fileName);
	return `${name}.${hash}${ext}`;
}

/** Options for {@link emitHashedOutputs}. */
export interface EmitHashedOutputsOptions {
	/** Absolute path to the output directory. */
	outDir: string;
	/** Logical (stable) output file name, e.g. `bundle.js`. */
	outFile: string;
	/** Manifest file name to write within `outDir`. */
	manifest: string;
	/** The bundled code — hashed and written under the hashed name. */
	code: string;
}

/** Result of {@link emitHashedOutputs}: absolute paths of the files written. */
export interface EmitHashedOutputsResult {
	/** Absolute path of the content-hashed bundle. */
	hashedFile: string;
	/** Absolute path of the manifest JSON. */
	manifestFile: string;
	/** The hashed file name (no directory), e.g. `bundle.a1b2c3d4.js`. */
	hashedName: string;
}

/**
 * Builds a RegExp that matches our own hashed file names for a given logical
 * name — `bundle.js` → /^bundle\.[0-9a-f]{len}\.js$/. Used to ensure watch-mode
 * cleanup only ever deletes files this tool produced.
 */
function hashedNamePattern(outFile: string, len: number): RegExp {
	const { name, ext } = parse(outFile);
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${esc(name)}\\.[0-9a-f]{${len}}${esc(ext)}$`);
}

/**
 * Writes the content-hashed bundle and an accompanying manifest, cleaning up the
 * previously emitted hashed file when the content (and therefore the hash) has
 * changed.
 *
 * The manifest maps the logical name to the hashed name
 * (`{ "bundle.js": "bundle.a1b2c3d4.js" }`) so a server or template can resolve
 * the cache-busted URL. It also doubles as a ledger: on each call we read the
 * previous manifest, and if the old hashed name differs from the new one (and
 * matches our `name.<hash>.ext` pattern), we remove the stale file. This keeps
 * watch mode from accumulating orphaned hashed bundles on every rebuild.
 *
 * The stable (unhashed) output file is written by the caller — this function
 * only adds the hashed file and the manifest.
 *
 * @param options - See {@link EmitHashedOutputsOptions}.
 * @returns Absolute paths of the hashed file and manifest, plus the hashed name.
 */
export async function emitHashedOutputs(
	options: EmitHashedOutputsOptions,
): Promise<EmitHashedOutputsResult> {
	const { outDir, outFile, manifest, code } = options;

	await mkdir(outDir, { recursive: true });

	const hash = await computeContentHash(code);
	const hashedName = insertHashIntoFileName(outFile, hash);
	const hashedFile = join(outDir, hashedName);
	const manifestFile = join(outDir, manifest);

	// Read the previous manifest (if any) to find the prior hashed name and
	// clean it up when the content changed (watch-mode orphan prevention).
	const previousHashedName = await readManifestEntry(manifestFile, outFile);
	if (
		previousHashedName &&
		previousHashedName !== hashedName &&
		hashedNamePattern(outFile, hash.length).test(previousHashedName)
	) {
		// force: a file already gone is fine; any other failure still throws
		await rm(join(outDir, previousHashedName), { force: true });
	}

	await writeFile(hashedFile, code);
	await writeFile(
		manifestFile,
		`${JSON.stringify({ [outFile]: hashedName }, null, 2)}\n`,
	);

	return { hashedFile, manifestFile, hashedName };
}

/**
 * Reads a single logical→hashed entry from an existing manifest file. Returns
 * undefined when the manifest is missing, unreadable, malformed, or lacks the
 * key — callers treat all of these as "no previous build".
 */
async function readManifestEntry(
	manifestFile: string,
	outFile: string,
): Promise<string | undefined> {
	try {
		const json = JSON.parse(await readFile(manifestFile, "utf8"));
		const value = json?.[outFile];
		return typeof value === "string" ? value : undefined;
	} catch {
		return undefined;
	}
}
