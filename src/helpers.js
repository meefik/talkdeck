import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';

export const exists = (p) => access(p).then(() => true, () => false);

export const hash = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' || Buffer.isBuffer(p) ? p : JSON.stringify(p)).update('\0');
  return h.digest('hex').slice(0, 24);
};
