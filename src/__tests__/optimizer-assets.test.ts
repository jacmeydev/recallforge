import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = path.join(process.cwd(), 'node_modules', 'fsrs-browser');
const PUBLIC_ROOT = path.join(process.cwd(), 'public', 'vendor', 'fsrs-browser');

function shouldInclude(relativePath: string): boolean {
  return !relativePath.endsWith('.d.ts') && !relativePath.endsWith('README.md');
}

function listFiles(root: string, current = root): string[] {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, absolutePath));
      continue;
    }

    const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
    if (shouldInclude(relativePath)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

describe('Optimizer assets integrity', () => {
  it('ships the same fsrs-browser asset set in public/vendor as in node_modules', () => {
    expect(fs.existsSync(SOURCE_ROOT)).toBe(true);
    expect(fs.existsSync(PUBLIC_ROOT)).toBe(true);

    const sourceFiles = listFiles(SOURCE_ROOT);
    const publicFiles = listFiles(PUBLIC_ROOT);

    expect(publicFiles).toEqual(sourceFiles);
  });

  it('keeps fsrs-browser JS, WASM, and worker assets byte-identical', () => {
    const files = listFiles(SOURCE_ROOT);
    expect(files.length).toBeGreaterThan(0);

    for (const relativePath of files) {
      const sourceBuffer = fs.readFileSync(path.join(SOURCE_ROOT, relativePath));
      const publicBuffer = fs.readFileSync(path.join(PUBLIC_ROOT, relativePath));

      expect(Buffer.compare(publicBuffer, sourceBuffer), relativePath).toBe(0);
    }
  });
});
