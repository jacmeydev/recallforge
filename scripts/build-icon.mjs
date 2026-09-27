// Renders assets/icon.png (512×512) from an inline SVG with the preinstalled Chromium.
import { chromium } from 'playwright';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a78d6"/><stop offset="1" stop-color="#104281"/></linearGradient></defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <rect x="150" y="118" width="250" height="300" rx="34" fill="#ffffff" opacity="0.35" transform="rotate(10 275 268)"/>
  <rect x="112" y="104" width="250" height="300" rx="34" fill="#ffffff"/>
  <rect x="150" y="170" width="174" height="22" rx="11" fill="#104281"/>
  <rect x="150" y="214" width="120" height="22" rx="11" fill="#86b6ef"/>
  <path d="M168 318 l38 38 l80 -86" fill="none" stroke="#16a34a" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: path.join(root, 'assets/icon.png'), omitBackground: true });
await browser.close();
console.log('assets/icon.png');
