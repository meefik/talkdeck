import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dirs = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  for (const c of CANDIDATES) {
    const paths = c.includes('/') || c.includes('\\') ? [c] : dirs.map((d) => `${d}/${c}`);
    for (const p of paths) {
      if (await access(p).then(() => true, () => false)) return p;
    }
  }
  throw new Error('Chrome/Chromium/Edge not found. Install one or set CHROME_PATH.');
}

/** Run fn(open) with a headless browser; `open(file, viewport)` returns a loaded page. */
export async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    executablePath: await findChrome(),
    headless: true,
    args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
  });
  try {
    return await fn(async (file, viewport = { width: 1280, height: 720 }) => {
      const page = await browser.newPage();
      await page.setViewport(viewport);
      await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      return page;
    });
  } finally {
    await browser.close();
  }
}
