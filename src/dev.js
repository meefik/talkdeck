import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { renderDeck, toPage, TEMPLATE_DIR } from './render.js';

const BUNDLED_THEMES = path.join(TEMPLATE_DIR, 'themes');

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

// Re-renders on every request (decks are small); the page polls /__version
// (newest mtime of slides.md, themes/ and assets/) and reloads when it changes.
const RELOAD = `<script>(async()=>{const v=()=>fetch('/__version').then(r=>r.text());let c=await v();
setInterval(async()=>{try{if(await v()!==c)location.reload()}catch{}},800)})()</script>`;

// newest mtime in a file or, recursively, a folder (a folder's own mtime ignores edits to files inside)
async function newestMtime(p) {
  let s;
  try { s = await stat(p); } catch { return 0; }
  if (!s.isDirectory()) return s.mtimeMs;
  let newest = s.mtimeMs;
  for (const f of await readdir(p).catch(() => [])) newest = Math.max(newest, await newestMtime(path.join(p, f)));
  return newest;
}

async function version(dir) {
  const watched = [path.join(dir, 'slides.md'), path.join(dir, 'themes'), path.join(dir, 'assets'), BUNDLED_THEMES];
  return String(Math.max(...(await Promise.all(watched.map(newestMtime)))));
}

export async function serve(dir, port, log) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/__version') return res.end(await version(dir));
      if (url.pathname === '/' || url.pathname === '/slides.html') {
        const html = await toPage(await renderDeck(dir));
        const end = html.lastIndexOf('</body>');
        const page = html.slice(0, end) + RELOAD + html.slice(end);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(page);
      }
      const file = path.join(dir, decodeURIComponent(url.pathname));
      const rel = path.relative(dir, file);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep)[0] === 'output') throw Object.assign(new Error(), { code: 'ENOENT' });
      res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      res.end(await readFile(file));
    } catch (e) {
      res.statusCode = e.code === 'ENOENT' ? 404 : 500;
      res.end(e.code === 'ENOENT' ? 'not found' : String(e.message));
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, resolve));
  log(`serving ${dir} at http://localhost:${port}/`);
}
