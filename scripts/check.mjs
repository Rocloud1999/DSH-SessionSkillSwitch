import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
for (const path of ['index.js', 'client.js', ...((await readdir(new URL('src/', root))).filter(name => name.endsWith('.mjs')).map(name => `src/${name}`))]) {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(path, root))], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${path}: ${result.stderr}`);
}
for (const path of [manifest.dsh.bundle.patch, manifest.exports['.'], manifest.exports['./client'], manifest.exports['./icon']]) await access(new URL(path, root));
for (const language of ['en', 'zh']) {
  const value = JSON.parse(await readFile(new URL(`locale/${language}.json`, root), 'utf8'));
  if (!value.meta.title || !value.meta.description) throw new Error(`Missing ${language} display metadata.`);
}
const icon = await readFile(new URL('icon.svg', root), 'utf8');
if (!icon.includes('http://www.w3.org/2000/svg') || icon.includes('<script') || icon.length > 262144) throw new Error('Invalid icon.');
console.log('Host/Client/module syntax, manifest paths, display resources: OK');
