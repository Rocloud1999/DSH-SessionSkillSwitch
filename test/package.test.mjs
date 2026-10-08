import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);

test('manifest exports an installable Host/Client bundle and includes its runtime files', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml'); assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.exports['.'], './index.js'); assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.dependencies, undefined); assert.equal(manifest.scripts.postinstall, undefined);
  for (const name of ['index.js', 'client.js', 'cordis.patch.yml', 'src/controller.mjs', 'src/storage.mjs', 'locale/en.json', 'locale/zh.json', 'icon.svg']) await access(new URL(name, root));
});
test('Client registers lazily without fetching, rendering, or touching the DOM at module load', async () => {
  let loaded;
  vm.runInNewContext(await readFile(new URL('client.js', root), 'utf8'), { window: { __ModuleLoader__: { load(value) { loaded = value; } } } });
  assert.equal(loaded.id, '@rocloud1999/dsh-session-skill-switch'); assert.equal(typeof loaded.factory, 'function');
  const client = loaded.factory(name => { assert.equal(name, 'react'); return { createElement: (...args) => args }; });
  const registrations = [], locales = []; let owner;
  const ctx = { effect: fn => fn(), locale: { register(ns, dictionaries) { locales.push({ ns, dictionaries }); return () => {}; } },
    slots: { inject(name, fn) { owner = name; return fn(); }, register(options, component) { registrations.push({ options, component }); return () => {}; } } };
  client.apply(ctx); assert.equal(owner, 'conversation.composer.dock'); assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.locale, 'session-skill-switch'); assert.ok(locales[0].dictionaries.zh.title);
  const vnode = registrations[0].component({ sessionId: 'session-test', t: key => key }); assert.equal(vnode[1].key, 'session-test');
});
test('display locales describe this plugin rather than a template', async () => {
  for (const language of ['en', 'zh']) { const data = JSON.parse(await readFile(new URL(`locale/${language}.json`, root), 'utf8')); assert.ok(data.meta.title); assert.ok(data.meta.description); assert.doesNotMatch(JSON.stringify(data), /My Decoration|my-plugin/); }
});
