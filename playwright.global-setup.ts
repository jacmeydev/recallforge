import fs from 'fs';
import path from 'path';

async function globalSetup() {
  const tempRoot = path.join(__dirname, '.tmp', 'playwright');
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
}

export default globalSetup;
