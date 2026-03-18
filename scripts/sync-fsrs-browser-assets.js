const fs = require('fs');
const path = require('path');

const packageRoot = path.join(process.cwd(), 'node_modules', 'fsrs-browser');
const targetRoot = path.join(process.cwd(), 'public', 'vendor', 'fsrs-browser');

function main() {
  if (!fs.existsSync(packageRoot)) {
    throw new Error(`fsrs-browser package not found at ${packageRoot}`);
  }

  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.cpSync(packageRoot, targetRoot, {
    recursive: true,
    filter: (source) => !source.endsWith('.d.ts') && !source.endsWith('README.md'),
  });

  console.log(`Synced fsrs-browser assets to ${targetRoot}`);
}

main();
