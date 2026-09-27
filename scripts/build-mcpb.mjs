// Builds dist/recallforge.mcpb: a one-click extension for Claude Desktop (and
// other hosts that open MCP Bundles). One universal file for macOS, Windows and
// Linux: the server is a single bundled script that stores data with Node's
// built-in SQLite, and the scheduler optimizer runs as WebAssembly, so no
// native module is needed.
import { execFileSync } from 'child_process';
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, 'build', 'mcpb');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'server'), { recursive: true });

// 1. The whole server in one file (the optimizer binding stays external: it loads its WebAssembly build).
await build({
  entryPoints: [path.join(root, 'src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(out, 'server', 'index.mjs'),
  external: ['better-sqlite3', '@open-spaced-repetition/binding', 'next', 'playwright'],
  alias: { '@': path.join(root, 'src') },
  banner: {
    js: "import { createRequire as __rfRequire } from 'module'; const require = __rfRequire(import.meta.url);",
  },
  define: { 'process.env.RECALLFORGE_SQLITE': '"node"' },
  logLevel: 'warning',
});

// 2. Runtime dependencies that cannot be bundled: the optimizer and its WebAssembly build.
const bindingVersion = pkg.dependencies['@open-spaced-repetition/binding'].replace(/^[^\d]*/, '');
fs.writeFileSync(
  path.join(out, 'server', 'package.json'),
  JSON.stringify(
    {
      name: 'recallforge-server',
      private: true,
      type: 'module',
      dependencies: {
        '@open-spaced-repetition/binding': bindingVersion,
        '@open-spaced-repetition/binding-wasm32-wasi': bindingVersion,
      },
    },
    null,
    2
  )
);
execFileSync('npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', '--force', '--ignore-scripts'], {
  cwd: path.join(out, 'server'),
  stdio: 'inherit',
});
// Only the WebAssembly build is wanted (the bundle must behave the same on every platform).
for (const dir of fs.readdirSync(path.join(out, 'server', 'node_modules', '@open-spaced-repetition'))) {
  if (dir !== 'binding' && dir !== 'binding-wasm32-wasi') fs.rmSync(path.join(out, 'server', 'node_modules', '@open-spaced-repetition', dir), { recursive: true });
}

// 3. Manifest.
const manifest = {
  manifest_version: '0.3',
  name: 'recallforge',
  display_name: 'RecallForge',
  version: pkg.version,
  description: 'Estudia con tarjetas y repetición espaciada (FSRS) dentro del chat: tus mazos de Anki, tarjetas desde tus apuntes y un tutor que te explica.',
  long_description:
    'RecallForge es tu memoria de estudio. Di «vamos a repasar» y tus tarjetas aparecen en el chat para responder y calificar con un clic o el teclado, con imágenes, cloze y la fuente exacta. Importa mazos de Anki (.apkg) con tu progreso, crea tarjetas desde PDF, diapositivas o apuntes como borradores que revisas, prepara exámenes, ve tu mapa de progreso y exporta a AnkiDroid/AnkiMobile. Todo se guarda en tu ordenador, sin cuentas.',
  author: { name: 'jacmeydev', url: 'https://github.com/jacmeydev' },
  homepage: 'https://github.com/jacmeydev/recallforge',
  repository: { type: 'git', url: 'https://github.com/jacmeydev/recallforge' },
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['--no-warnings', '${__dirname}/server/index.mjs', 'mcp'],
      env: { RECALLFORGE_DIR: '${user_config.data_dir}' },
    },
  },
  user_config: {
    data_dir: {
      type: 'directory',
      title: 'Carpeta de datos',
      description: 'Dónde se guardan tus tarjetas (un solo archivo, recallforge.db). Úsala también desde la web o la terminal para compartir los mismos datos.',
      default: '${HOME}/.recallforge',
      required: false,
    },
  },
  tools: [
    { name: 'study', description: 'Sesión de estudio interactiva en el chat' },
    { name: 'show_progress', description: 'Mapa de progreso y qué estudiar ahora' },
    { name: 'add_cards', description: 'Crear tarjetas (básicas, cloze, con imágenes)' },
    { name: 'add_document', description: 'Guardar apuntes, PDF o diapositivas para convertirlos en tarjetas' },
    { name: 'import_data', description: 'Importar mazos de Anki (.apkg), copias o CSV' },
    { name: 'export_data', description: 'Exportar a Anki/AnkiDroid/AnkiMobile, JSON o TSV' },
    { name: 'explain_card', description: 'Explicar una tarjeta con su fuente' },
    { name: 'optimize_scheduler', description: 'Ajustar el algoritmo a tu memoria' },
  ],
  prompts: [
    { name: 'study', description: 'Empezar una sesión de estudio', arguments: ['deck', 'tag', 'mode'], text: 'Empieza una sesión de estudio de RecallForge.' },
  ],
  keywords: ['flashcards', 'anki', 'spaced repetition', 'fsrs', 'study', 'medicina', 'estudio'],
  license: pkg.license || 'ISC',
  compatibility: {
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=22.5.0' },
  },
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(out, 'icon.png'));

// 4. Zip it.
const zip = new JSZip();
const add = (dir, prefix = '') => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) add(full, name);
    else zip.file(name, fs.readFileSync(full), { unixPermissions: fs.statSync(full).mode });
  }
};
add(out);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const target = path.join(root, 'dist', 'recallforge.mcpb');
fs.writeFileSync(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' }));
console.log(`${path.relative(root, target)}: ${(fs.statSync(target).size / 1e6).toFixed(1)} MB`);

// 5. The same server as an npm package (npx recallforge mcp). It prefers better-sqlite3 when it
//    installs (optional dependency) and falls back to node:sqlite.
const npmDir = path.join(root, 'build', 'npm');
fs.rmSync(npmDir, { recursive: true, force: true });
fs.mkdirSync(npmDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(npmDir, 'recallforge.mjs'),
  external: ['better-sqlite3', '@open-spaced-repetition/binding', 'next', 'playwright'],
  alias: { '@': path.join(root, 'src') },
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __rfRequire } from 'module'; const require = __rfRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
fs.chmodSync(path.join(npmDir, 'recallforge.mjs'), 0o755);
fs.writeFileSync(
  path.join(npmDir, 'package.json'),
  JSON.stringify(
    {
      name: 'recallforge',
      version: pkg.version,
      description: manifest.description,
      keywords: manifest.keywords,
      homepage: manifest.homepage,
      repository: manifest.repository,
      license: manifest.license,
      author: 'jacmeydev',
      type: 'module',
      bin: { recallforge: 'recallforge.mjs' },
      files: ['recallforge.mjs', 'README.md', 'icon.png'],
      engines: { node: '>=20' },
      dependencies: { '@open-spaced-repetition/binding': bindingVersion },
      optionalDependencies: { 'better-sqlite3': pkg.dependencies['better-sqlite3'] },
    },
    null,
    2
  ) + '\n'
);
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(npmDir, 'icon.png'));
fs.writeFileSync(
  path.join(npmDir, 'README.md'),
  `# RecallForge

${manifest.description}

\`\`\`bash
claude mcp add recallforge -- npx -y recallforge mcp
\`\`\`

Any MCP client:

\`\`\`json
{ "mcpServers": { "recallforge": { "command": "npx", "args": ["-y", "recallforge", "mcp"] } } }
\`\`\`

Your data stays in \`~/.recallforge/recallforge.db\`. Full documentation, the Claude Desktop extension and the local web app: ${manifest.homepage}
`
);
console.log('build/npm: npm package ready (npm publish build/npm)');
