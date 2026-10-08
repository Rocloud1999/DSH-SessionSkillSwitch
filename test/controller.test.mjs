import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, open, symlink, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { SessionSkillController } from '../src/controller.mjs';
import { JsonStore, defaultStateDir } from '../src/storage.mjs';
import { commandHandler } from '../src/commands.mjs';
import { fixture, skill, agent, confirm } from './fixtures.mjs';
const code = expected => error => error.code === expected;

test('inspection uses native resolved metadata and never loads bodies', async t => {
  const { controller, registry, a } = await fixture(t);
  const view = await controller.inspect(a);
  assert.deepEqual(view.rows.map(row => [row.name, row.selected, row.group]), [['heavy', false, 'optional'], ['light', true, 'common']]);
  assert.deepEqual(registry.reads, []); assert.equal(view.confirmed, false);
  assert.ok(registry.options.every(option => option.scope === a && option.cwd === '/workspace'));
});
test('inspection matches metadata by name even if provider order changes', async t => {
  const { controller, registry, a } = await fixture(t); registry.skills.reverse();
  const view = await controller.inspect(a); assert.equal(view.rows[0].name, 'heavy'); assert.equal(view.rows[0].description, 'Description heavy');
});
test('missing confirmation fails closed', async t => {
  const { controller, a } = await fixture(t); await assert.rejects(controller.prepare(a), code('UNCONFIGURED'));
});
test('explicit empty choice survives restart and remains empty', async t => {
  const { controller, store, registry, a } = await fixture(t); await confirm(controller, a, []);
  const restarted = new SessionSkillController(() => registry, { commonSkills: ['heavy', 'light'] }, new JsonStore(store.directory));
  const view = await restarted.inspect(a); assert.equal(view.confirmed, true); assert.ok(view.rows.every(row => !row.selected));
  assert.deepEqual((await restarted.prepare(a)).entries, []);
});
test('common can be disabled and optional explicitly enabled', async t => {
  const { controller, a } = await fixture(t); await confirm(controller, a, ['heavy']);
  assert.deepEqual((await controller.prepare(a)).entries.map(row => row.name), ['heavy']);
});
test('profile classification persists without mutating existing selections', async t => {
  const { controller, registry, store, a } = await fixture(t); await confirm(controller, a);
  let view = await controller.inspect(a);
  await controller.classify(a, { names: ['heavy'], group: 'common', groupRevision: view.groupRevision });
  const restarted = new SessionSkillController(() => registry, {}, store), b = agent();
  assert.equal((await restarted.inspect(b)).rows.find(row => row.name === 'heavy').selected, true);
  assert.equal((await restarted.inspect(a)).rows.find(row => row.name === 'heavy').selected, false);
});
test('multiple sessions never share temporary choices', async t => {
  const { controller, a } = await fixture(t); const b = agent();
  await confirm(controller, a, ['heavy']); await confirm(controller, b, ['light']);
  assert.deepEqual((await controller.prepare(a)).entries.map(row => row.name), ['heavy']);
  assert.deepEqual((await controller.prepare(b)).entries.map(row => row.name), ['light']);
});
test('start fence is persisted and prohibits edits even without a logged model reply', async t => {
  const { controller, a, store, registry } = await fixture(t); await confirm(controller, a);
  const prepared = await controller.prepare(a); await controller.seal(a, prepared.state);
  const restarted = new SessionSkillController(() => registry, {}, store);
  await assert.rejects(confirm(restarted, a, ['heavy']), code('SESSION_STARTED'));
});
test('existing history without plugin state is not falsely treated as a clean session', async t => {
  const { controller, a } = await fixture(t); a.append('step/start');
  const view = await controller.inspect(a); assert.equal(view.legacy, true);
  await assert.rejects(confirm(controller, a), code('SESSION_STARTED'));
});
test('normal forks require a new clean conversation; they do not silently inherit', async t => {
  const { controller, a } = await fixture(t); await confirm(controller, a); await controller.seal(a, (await controller.prepare(a)).state);
  const fork = agent(undefined, { parentSession: a.id, isSeeded: true }); fork.append('assistant/message');
  await assert.rejects(controller.prepare(fork), code('UNCONFIGURED')); assert.equal((await controller.inspect(fork)).legacy, true);
});
test('subagents inherit only already-selected unchanged skills, never new common skills', async t => {
  const { controller, registry, a } = await fixture(t); await confirm(controller, a); await controller.seal(a, (await controller.prepare(a)).state);
  registry.skills.push(skill('new-skill'));
  const child = agent(undefined, { origin: 'subagent', parentSession: a.id });
  const prepared = await controller.prepare(child); assert.deepEqual(prepared.entries.map(row => row.name), ['light']); assert.equal(prepared.state.locked, true);
});
test('subagents cannot inherit from an unconfirmed parent', async t => {
  const { controller, a } = await fixture(t); const child = agent(undefined, { origin: 'subagent', parentSession: a.id });
  await assert.rejects(controller.prepare(child), code('UNCONFIGURED'));
});
test('disabled skill is rejected before provider.get for user and model callers', async t => {
  const { controller, registry, a } = await fixture(t); await confirm(controller, a);
  for (const caller of ['user', 'model']) await assert.rejects(controller.load(a, 'heavy', caller), code('NOT_SELECTED'));
  assert.deepEqual(registry.reads, []);
});
test('loader rechecks returned metadata, not just the discovery summary', async t => {
  const { controller, registry, a } = await fixture(t); await confirm(controller, a);
  registry.getOverride = () => ({ ...registry.skills[1], provider: 'different', content: 'SECRET' });
  await assert.rejects(controller.load(a, 'light', 'model'), code('SKILL_CHANGED'));
});
test('base invocation restrictions cannot be elevated by selecting a skill', async t => {
  const { controller, registry, a } = await fixture(t);
  registry.skills[1].invocation = { modelInvocable: false, userInvocable: true }; await confirm(controller, a);
  assert.deepEqual((await controller.prepare(a)).entries, []);
  await assert.rejects(controller.load(a, 'light', 'model'), code('INVOCATION_DISABLED'));
  assert.equal((await controller.load(a, 'light', 'user')).content, 'BODY light');
});
test('body-only edits use fresh content on every call', async t => {
  const { controller, registry, a } = await fixture(t); await confirm(controller, a);
  registry.getOverride = () => ({ ...registry.skills[1], content: 'new body' });
  assert.equal((await controller.load(a, 'light', 'model')).content, 'new body');
});
test('changing the winning provider/description hides the skill, not its replacement metadata', async t => {
  const { controller, registry, a } = await fixture(t); await confirm(controller, a);
  registry.skills[1] = { ...registry.skills[1], description: 'NEW PRIVATE DESCRIPTION' };
  assert.deepEqual((await controller.prepare(a)).entries, []);
  await assert.rejects(controller.load(a, 'light', 'model'), code('SKILL_CHANGED'));
});
test('incomplete discovery cannot be confirmed or replace a model view', async t => {
  const { controller, registry, a } = await fixture(t); const view = await controller.inspect(a); registry.complete = false;
  await assert.rejects(controller.confirm(a, { ...view, selected: [] }), code('INCOMPLETE_CATALOG'));
  await assert.rejects(controller.prepare(a), code('INCOMPLETE_CATALOG'));
});
test('stale browser catalog fails confirmation instead of enabling newly discovered entries', async t => {
  const { controller, registry, a } = await fixture(t); const view = await controller.inspect(a); registry.skills.push(skill('new'));
  await assert.rejects(controller.confirm(a, { ...view, selected: ['light'] }), code('STALE_DRAFT'));
});
test('optimistic session revision prevents lost updates across tabs', async t => {
  const { controller, a } = await fixture(t); const view = await controller.inspect(a); await confirm(controller, a, []);
  await assert.rejects(controller.confirm(a, { ...view, selected: ['heavy'] }), code('STALE_STATE'));
});
test('optimistic group revision prevents lost profile updates', async t => {
  const { controller, a } = await fixture(t);
  await controller.classify(a, { names: ['heavy'], group: 'common', groupRevision: 0 });
  await assert.rejects(controller.classify(a, { names: ['light'], group: 'optional', groupRevision: 0 }), code('STALE_STATE'));
});
test('unknown selected names and duplicate names are rejected', async t => {
  const { controller, a } = await fixture(t); const view = await controller.inspect(a);
  await assert.rejects(controller.confirm(a, { ...view, selected: ['missing'] }), code('UNKNOWN_SKILL'));
  await assert.rejects(controller.confirm(a, { ...view, selected: ['light', 'light'] }), code('INVALID_SELECTION'));
});
test('workspace change cannot reuse a saved selection', async t => {
  const { controller, a } = await fixture(t); await confirm(controller, a); a.session.header.cwd = '/elsewhere';
  await assert.rejects(controller.prepare(a), code('SCOPE_MISMATCH'));
});
test('corrupt state is never silently replaced by defaults', async t => {
  const { controller, store, a } = await fixture(t); await confirm(controller, a); await writeFile(store.path('session', a.id), '{bad');
  await assert.rejects(controller.inspect(a), code('CORRUPT_STATE'));
});
test('state paths hash untrusted session identities and cannot traverse directories', async t => {
  const { store } = await fixture(t); assert.match(store.path('session', '../../etc/passwd'), /session-[a-f0-9]{64}\.json$/);
  assert.ok(store.path('session', '../../etc/passwd').startsWith(store.directory + sep));
});
test('writer lock and file permissions are enforced', async t => {
  const { controller, store, a } = await fixture(t); await confirm(controller, a);
  const lock = await open(store.path('session', a.id) + '.lock', 'wx'); t.after(() => lock.close());
  await assert.rejects(confirm(controller, a, []), code('STATE_BUSY'));
  if (process.platform !== 'win32') assert.equal((await stat(store.path('session', a.id))).mode & 0o777, 0o600);
});
test('symlink state files are rejected', async t => {
  const { controller, store, dir, a } = await fixture(t);
  const target = join(dir, 'target.json'); await writeFile(target, '{}');
  try { await symlink(target, store.path('session', a.id)); } catch (error) { if (error.code === 'EPERM') return t.skip('Symlinks unavailable'); throw error; }
  await assert.rejects(controller.inspect(a), code('CORRUPT_STATE'));
});
test('aborted writes preserve previous selection', async t => {
  const { controller, store, a } = await fixture(t); await confirm(controller, a); const before = await readFile(store.path('session', a.id), 'utf8');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(store.update('session', a.id, 1, () => { throw new Error('must not run'); }, abort.signal));
  assert.equal(await readFile(store.path('session', a.id), 'utf8'), before);
});
test('cancellation after provider read does not return a body', async t => {
  const { controller, registry, a } = await fixture(t); await confirm(controller, a); const abort = new AbortController();
  registry.getOverride = () => { abort.abort(); return { ...registry.skills[1], content: 'secret' }; };
  await assert.rejects(controller.load(a, 'light', 'model', abort.signal), { name: 'AbortError' });
});
test('human command grammar supports opt-in, opt-out and explicit empty sessions', async t => {
  const { controller, a } = await fixture(t); const handler = commandHandler(controller, new AbortController().signal);
  assert.equal((await handler({ agent: a, rawInput: 'confirm +heavy -light' })).kind, 'success');
  assert.deepEqual((await controller.prepare(a)).entries.map(row => row.name), ['heavy']);
  assert.equal((await handler({ agent: a, rawInput: 'none' })).kind, 'success');
  assert.deepEqual((await controller.prepare(a)).entries, []);
});
test('structured human command returns parseable view and rejects malformed JSON', async t => {
  const { controller, a } = await fixture(t); const handler = commandHandler(controller, new AbortController().signal);
  const result = await handler({ agent: a, rawInput: '{"action":"inspect"}' }); assert.equal(JSON.parse(result.text).sessionId, a.id);
  assert.equal((await handler({ agent: a, rawInput: '{no' })).kind, 'error');
});
test('prototype-like kebab-case names are classified normally', async t => {
  const { registry, controller, a } = await fixture(t); registry.skills.push(skill('constructor'));
  const row = (await controller.inspect(a)).rows.find(row => row.name === 'constructor'); assert.equal(row.group, 'optional');
});
test('profile locations are isolated and relative stateDir is rejected', () => {
  assert.equal(defaultStateDir({ DSH_PROFILE_DIR: '/profiles/a', DSH_HOME: '/home/dsh' }), join('/profiles/a', 'plugin-data', 'session-skill-switch'));
  assert.throws(() => new JsonStore('relative'), code('INVALID_CONFIG'));
});

test('a completed confirmation is acknowledged even if subsequent provider discovery would fail', async t => {
  const { controller, store, registry, a } = await fixture(t);
  const update = store.update.bind(store);
  store.update = async (...args) => { const value = await update(...args); registry.complete = false; return value; };
  const result = await confirm(controller, a);
  assert.equal(result.confirmed, true);
  await assert.rejects(controller.prepare(a), code('INCOMPLETE_CATALOG'));
});
