import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { renderDeck, toPage } from './render.js';

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

// Re-renders on every request (decks are small); the page polls /__version
// (newest mtime of slides.md, themes/ and assets/) and reloads when it changes.
const RELOAD = `<script>(async()=>{const v=()=>fetch('/__version').then(r=>r.text());let c=await v();
setInterval(async()=>{try{if(await v()!==c)location.reload()}catch{}},800)})()</script>`;

async function version(dir) {
  let newest = 0;
  for (const f of ['slides.md', 'themes', 'assets']) {
    try { newest = Math.max(newest, (await stat(path.join(dir, f))).mtimeMs); } catch {}
  }
  return String(newest);
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
      if (!file.startsWith(dir + path.sep) || file.includes(`${path.sep}dist${path.sep}`)) throw Object.assign(new Error(), { code: 'ENOENT' });
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
