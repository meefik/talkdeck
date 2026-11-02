import { createHash } from 'node:crypto';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const hash = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' || Buffer.isBuffer(p) ? p : JSON.stringify(p)).update('\0');
  return h.digest('hex').slice(0, 24);
};

const exists = (p) => access(p).then(() => true, () => false);

/**
 * Generated files live in the output directory under readable names
 * (voiceovers/slide01.wav, ...). `<out>/.cache.json` remembers the input hash
 * each one was generated from, so a file is reused only while its inputs are unchanged.
 */
export async function openCache(outDir) {
  const manifest = path.join(outDir, '.cache.json');
  const keys = await readFile(manifest, 'utf8').then(JSON.parse, () => ({}));
  return {
    /** true if `file` exists and was generated from `key` */
    async fresh(file, key) {
      return keys[path.relative(outDir, file)] === key && (await exists(file));
    },
    async record(file, key) {
      keys[path.relative(outDir, file)] = key;
      await writeFile(manifest, JSON.stringify(keys, null, 2));
    },
    async remove(file) {
      delete keys[path.relative(outDir, file)];
      await rm(file, { force: true });
    },
  };
}
