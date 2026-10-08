import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraft, confirmSelection, modelCatalog, assertSkillAccess,
  renderModelCatalog, restoreSelection, resolveGroups,
} from '../src/policy.mjs';

const skill = (name, extra = {}) => ({
  name, description: `Description for ${name}`, provider: 'filesystem',
  source: 'user-dsh', path: `/skills/${name}/SKILL.md`,
  invocation: { modelInvocable: true, userInvocable: true }, ...extra,
});
const catalog = [skill('light'), skill('heavy')];
const scope = { sessionId: 'session-a', workspaceKey: 'workspace-a' };
const policy = { defaultGroup: 'optional', groups: { light: 'common', heavy: 'optional' } };
const makeDraft = (extra = {}) => createDraft({ ...scope, catalog, complete: true, policy, ...extra });
const commit = (draft = makeDraft(), current = catalog) => confirmSelection({
  draft, catalog: current, complete: true, now: '2026-10-08T10:33:08.000Z',
});
const checkCode = code => error => error.code === code;
const entries = snapshot => modelCatalog({ snapshot, scope, catalog, complete: true });

test('common defaults on and optional defaults off', () => {
  assert.deepEqual(makeDraft().rows.map(row => [row.name, row.selected]), [['heavy', false], ['light', true]]);
  assert.deepEqual(entries(commit()).map(row => row.name), ['light']);
});
test('session overrides independently disable common and enable optional', () => {
  const snapshot = commit(makeDraft({ overrides: { light: false, heavy: true } }));
  assert.deepEqual(entries(snapshot).map(row => row.name), ['heavy']);
});
test('explicit empty selection stays empty across JSON persistence', () => {
  const snapshot = restoreSelection(JSON.parse(JSON.stringify(commit(makeDraft({ overrides: { light: false } })))));
  assert.deepEqual(entries(snapshot), []);
  assert.equal(renderModelCatalog(entries(snapshot)), '<available_skills>\n</available_skills>');
});
test('disabled metadata never appears in rendered model catalog', () => {
  const output = renderModelCatalog(entries(commit()));
  assert.doesNotMatch(output, /heavy|Description for heavy/);
  assert.match(output, /light/);
});
test('unknown newly discovered skills default to optional', () => {
  const additional = [...catalog, skill('new-skill')];
  const draft = makeDraft({ catalog: additional });
  assert.equal(draft.rows.find(row => row.name === 'new-skill').selected, false);
});
test('new skills, even common ones, do not enter an already frozen session', () => {
  const snapshot = commit();
  const rows = modelCatalog({ snapshot, scope, complete: true, catalog: [...catalog, skill('new-common')] });
  assert.deepEqual(rows.map(row => row.name), ['light']);
});
test('group configuration change cannot alter an existing snapshot', () => {
  const snapshot = commit();
  const changed = resolveGroups({ groups: { heavy: 'common', light: 'optional' } });
  assert.equal(changed.groups.heavy, 'common');
  assert.deepEqual(entries(snapshot).map(row => row.name), ['light']);
});
test('workspace classification overrides the global classification', () => {
  const resolved = resolveGroups(policy, { light: 'optional', heavy: 'common' });
  assert.deepEqual(entries(commit(makeDraft({ policy: resolved }))).map(row => row.name), ['heavy']);
});
test('concurrent sessions keep independent selections', () => {
  const a = commit();
  const bScope = { ...scope, sessionId: 'session-b' };
  const b = commit(makeDraft({ ...bScope, overrides: { light: false, heavy: true } }));
  assert.deepEqual(entries(a).map(row => row.name), ['light']);
  assert.deepEqual(modelCatalog({ snapshot: b, scope: bScope, catalog, complete: true }).map(row => row.name), ['heavy']);
});
test('another session or workspace cannot reuse a selection accidentally', () => {
  for (const wrong of [{ ...scope, sessionId: 'session-b' }, { ...scope, workspaceKey: 'workspace-b' }]) {
    assert.throws(() => modelCatalog({ snapshot: commit(), scope: wrong, catalog, complete: true }), checkCode('SCOPE_MISMATCH'));
  }
});
test('resuming preserves selection without consulting changed defaults', () => {
  const before = commit(makeDraft({ overrides: { heavy: true } }));
  assert.deepEqual(entries(restoreSelection(JSON.parse(JSON.stringify(before)))), entries(before));
});
test('unconfirmed state blocks model admission instead of falling back to all skills', () => {
  assert.throws(() => entries(undefined), checkCode('UNCONFIGURED'));
});
test('disabled skills are rejected through both model and direct-user invocation', () => {
  for (const caller of ['model', 'user']) {
    assert.throws(() => assertSkillAccess({ snapshot: commit(), scope, skill: catalog[1], caller }), checkCode('NOT_SELECTED'));
  }
});
test('enabled skill can be loaded through permitted invocation modes', () => {
  for (const caller of ['model', 'user']) {
    assert.doesNotThrow(() => assertSkillAccess({ snapshot: commit(), scope, skill: catalog[0], caller }));
  }
});
test('manual selection never overrides original model invocation prohibition', () => {
  const userOnly = skill('user-only', { invocation: { modelInvocable: false, userInvocable: true } });
  const list = [userOnly];
  const snapshot = commit(makeDraft({ catalog: list, overrides: { 'user-only': true } }), list);
  assert.deepEqual(modelCatalog({ snapshot, scope, catalog: list, complete: true }), []);
  assert.throws(() => assertSkillAccess({ snapshot, scope, skill: userOnly, caller: 'model' }), checkCode('INVOCATION_DISABLED'));
  assert.doesNotThrow(() => assertSkillAccess({ snapshot, scope, skill: userOnly, caller: 'user' }));
});
test('manual selection never overrides original user invocation prohibition', () => {
  const modelOnly = skill('model-only', { invocation: { modelInvocable: true, userInvocable: false } });
  const list = [modelOnly];
  const snapshot = commit(makeDraft({ catalog: list, overrides: { 'model-only': true } }), list);
  assert.throws(() => assertSkillAccess({ snapshot, scope, skill: modelOnly, caller: 'user' }), checkCode('INVOCATION_DISABLED'));
});
test('changed provider, source, path, description or invocation policy invalidates a binding', () => {
  const snapshot = commit();
  for (const change of [
    { provider: 'remote' }, { source: 'project-dsh' }, { path: '/another/SKILL.md' },
    { description: 'Replacement description' }, { invocation: { modelInvocable: false, userInvocable: true } },
  ]) {
    const changed = { ...catalog[0], ...change };
    assert.throws(() => assertSkillAccess({ snapshot, scope, skill: changed, caller: 'model' }), checkCode('SKILL_CHANGED'));
    assert.deepEqual(modelCatalog({ snapshot, scope, catalog: [changed], complete: true }), []);
  }
});
test('body-only changes retain DSH on-demand body loading semantics', () => {
  assert.doesNotThrow(() => assertSkillAccess({ snapshot: commit(), scope, skill: { ...catalog[0], content: 'Updated body' }, caller: 'model' }));
});
test('catalog changes after the selection screen opened invalidate confirmation', () => {
  assert.throws(() => commit(makeDraft(), [...catalog, skill('new')]), checkCode('STALE_DRAFT'));
});
test('incomplete discovery cannot create, confirm or replace a visible catalog', () => {
  assert.throws(() => makeDraft({ complete: false }), checkCode('INCOMPLETE_CATALOG'));
  assert.throws(() => confirmSelection({ draft: makeDraft(), catalog, complete: false }), checkCode('INCOMPLETE_CATALOG'));
  assert.throws(() => modelCatalog({ snapshot: commit(), scope, catalog, complete: false }), checkCode('INCOMPLETE_CATALOG'));
});
test('removed skills disappear and never enable a different skill', () => {
  assert.deepEqual(modelCatalog({ snapshot: commit(), scope, catalog: [catalog[1]], complete: true }), []);
});
test('duplicate raw-directory names are rejected, preserving DSH responsibility for precedence', () => {
  assert.throws(() => makeDraft({ catalog: [catalog[0], { ...catalog[0], source: 'project-dsh' }] }), checkCode('UNRESOLVED_DUPLICATE'));
});
test('invalid group, unknown name and non-boolean overrides are rejected', () => {
  assert.throws(() => resolveGroups({ groups: { light: 'sometimes' } }), checkCode('INVALID_CONFIG'));
  assert.throws(() => makeDraft({ overrides: { unknown: true } }), checkCode('UNKNOWN_SKILL'));
  assert.throws(() => makeDraft({ overrides: { light: 'false' } }), checkCode('INVALID_OVERRIDE'));
  assert.throws(() => makeDraft({ overrides: { '../skill': true } }), checkCode('INVALID_NAME'));
});
test('malformed persisted snapshots fail rather than widening access', () => {
  for (const value of [null, {}, { ...commit(), version: 2 }, { ...commit(), selected: null },
    { ...commit(), selected: [...commit().selected, ...commit().selected] }]) {
    assert.throws(() => restoreSelection(value));
  }
});
test('draft and snapshot values are deeply immutable', () => {
  const draft = makeDraft();
  const snapshot = commit(draft);
  assert.throws(() => { draft.rows[0].selected = true; }, TypeError);
  assert.throws(() => { snapshot.selected.push({ name: 'heavy' }); }, TypeError);
});
test('configuration-only metadata stays out of model entries', () => {
  for (const row of entries(commit())) assert.deepEqual(Object.keys(row), ['name', 'description']);
});
test('descriptions are escaped, normalized and bounded', () => {
  const rendered = renderModelCatalog([{ name: 'safe', description: '<tag>\nA & B' }]);
  assert.equal(rendered, '<available_skills>\n- `safe`: &lt;tag&gt; A &amp; B\n</available_skills>');
  assert.match(renderModelCatalog([{ name: 'safe', description: 'abcdef' }], 3), /ab…/);
});
test('denied invocation never calls the body loader', async () => {
  let reads = 0;
  async function load(summary) {
    assertSkillAccess({ snapshot: commit(), scope, skill: summary, caller: 'model' });
    reads++;
    const full = { ...summary, content: 'body' };
    assertSkillAccess({ snapshot: commit(), scope, skill: full, caller: 'model' });
    return full;
  }
  await assert.rejects(() => load(catalog[1]), checkCode('NOT_SELECTED'));
  assert.equal(reads, 0);
  await load(catalog[0]);
  assert.equal(reads, 1);
});
