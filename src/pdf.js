import { withBrowser } from './browser.js';

export async function writePdf(htmlFile, pdfFile) {
  await withBrowser(async (open) => {
    const page = await open(htmlFile);
    await page.emulateMediaType('print');
    await page.pdf({ path: pdfFile, printBackground: true, preferCSSPageSize: true });
  });
}
