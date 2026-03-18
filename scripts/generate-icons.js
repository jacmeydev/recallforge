const sharp = require('sharp');
const path = require('path');

const svgIcon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7c3aed"/>
      <stop offset="100%" style="stop-color:#4f46e5"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="url(#bg)"/>
  <text x="50%" y="54%" dominant-baseline="central" text-anchor="middle" 
        font-family="system-ui, -apple-system, sans-serif" font-weight="700" 
        font-size="${Math.round(size * 0.42)}" fill="white" letter-spacing="-${Math.round(size * 0.01)}">RF</text>
</svg>`;

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'icons');
  
  // Generate 192x192
  await sharp(Buffer.from(svgIcon(192)))
    .png()
    .toFile(path.join(outDir, 'icon-192.png'));
  console.log('Created icon-192.png');

  // Generate 512x512
  await sharp(Buffer.from(svgIcon(512)))
    .png()
    .toFile(path.join(outDir, 'icon-512.png'));
  console.log('Created icon-512.png');

  // Generate favicon (32x32 as ICO-compatible PNG)
  await sharp(Buffer.from(svgIcon(32)))
    .png()
    .toFile(path.join(__dirname, '..', 'public', 'favicon.ico'));
  console.log('Created favicon.ico');
}

main().catch(console.error);
