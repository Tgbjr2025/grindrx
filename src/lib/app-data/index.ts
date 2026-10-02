import { appDataDir } from "@tauri-apps/api/path";
import {
	BaseDirectory,
	exists,
	mkdir,
	readFile,
	rename,
	writeFile,
} from "@tauri-apps/plugin-fs";

export async function existsAppDataFile(path: string) {
	return await exists(path, { baseDir: BaseDirectory.AppData });
}

export async function readAppDataFile(path: string) {
	return await readFile(path, {
		baseDir: BaseDirectory.AppData,
	});
}

export async function writeAppDataFile(path: string, content: Uint8Array) {
	await mkdir(await appDataDir(), {
		recursive: true,
	});
	// Atomic write: write to a temp sibling, then rename over the real path.
	// A direct writeFile truncates the target first, so a crash mid-write would
	// leave a partially-written (corrupt) file. `rename` is atomic on the same
	// filesystem, so a reader ever sees either the old file or the complete new
	// one — never a half-written one. @tauri-apps/plugin-fs exports `rename`,
	// and the temp file lives in the same AppData dir so both paths share a
	// filesystem. (Requires the `fs:allow-rename` capability plus a write scope
	// covering the `.tmp` sibling — see FIX_NOTES.)
	const tmpPath = `${path}.tmp`;
	await writeFile(tmpPath, content, {
		baseDir: BaseDirectory.AppData,
	});
	await rename(tmpPath, path, {
		oldPathBaseDir: BaseDirectory.AppData,
		newPathBaseDir: BaseDirectory.AppData,
	});
}
