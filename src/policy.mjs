/**
 * Pure, framework-independent session skill policy.
 * No model calls, filesystem access, registry mutations, or global session state.
 * The DSH Host adapter must authenticate writes and persist the returned snapshot.
 */
import { createHash } from 'node:crypto';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const own = (object, key) => Object.hasOwn(object, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class SkillPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SkillPolicyError';
    this.code = code;
  }
}

function fail(code, message) { throw new SkillPolicyError(code, message); }
function skillName(value) {
  if (typeof value !== 'string' || !NAME.test(value)) fail('INVALID_NAME', 'Invalid skill name.');
  return value;
}
function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Existing DSH invocation policy remains authoritative: selection cannot elevate it. */
function validateSkill(skill) {
  if (!record(skill)) fail('INVALID_CATALOG', 'A skill must be an object.');
  skillName(skill.name);
  if (typeof skill.description !== 'string' || typeof skill.source !== 'string' ||
      typeof skill.provider !== 'string' || !skill.provider || !record(skill.invocation) ||
      typeof skill.invocation.modelInvocable !== 'boolean' ||
      typeof skill.invocation.userInvocable !== 'boolean' ||
      (skill.path !== undefined && typeof skill.path !== 'string')) {
    fail('INVALID_CATALOG', `Invalid summary for ${skill.name}.`);
  }
}
function sortedCatalog(skills) {
  if (!Array.isArray(skills)) fail('INVALID_CATALOG', 'Expected a resolved skill array.');
  const names = new Set();
  for (const skill of skills) {
    validateSkill(skill);
    if (names.has(skill.name)) fail('UNRESOLVED_DUPLICATE', 'Use the resolved DSH registry, not raw directory entries.');
    names.add(skill.name);
  }
  return [...skills].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/**
 * Binding detects changed winning providers/paths/descriptions/policies. It deliberately
 * does not hash the body: DSH reads the body on demand. This is not version pinning.
 */
function binding(skill) {
  validateSkill(skill);
  return hash([
    skill.name, skill.provider, skill.source, skill.path ?? null,
    skill.description, skill.invocation.modelInvocable, skill.invocation.userInvocable,
  ]);
}

/**
 * The only classification values are common / optional. Unclassified skills are optional.
 * workspaceGroups is an explicit workspace overlay supplied by the adapter, not a cwd guess.
 */
export function resolveGroups({ defaultGroup = 'optional', groups = {} } = {}, workspaceGroups = {}) {
  if (!['common', 'optional'].includes(defaultGroup) || !record(groups) || !record(workspaceGroups)) {
    fail('INVALID_CONFIG', 'Invalid classification configuration.');
  }
  const result = {};
  for (const layer of [groups, workspaceGroups]) {
    for (const [name, group] of Object.entries(layer)) {
      skillName(name);
      if (!['common', 'optional'].includes(group)) fail('INVALID_CONFIG', 'Group must be common or optional.');
      result[name] = group;
    }
  }
  return freeze({ defaultGroup, groups: result });
}

/**
 * A complete resolved catalog is required at the configuration boundary. The fingerprint
 * prevents committing a UI selection against a catalog that changed after it was displayed.
 */
export function createDraft({ sessionId, workspaceKey, catalog, complete, policy, overrides = {} }) {
  if (typeof sessionId !== 'string' || !sessionId || typeof workspaceKey !== 'string' || !workspaceKey) {
    fail('INVALID_SCOPE', 'Stable session and workspace identifiers are required.');
  }
  if (complete !== true) fail('INCOMPLETE_CATALOG', 'Retry discovery before confirming session skills.');
  if (!record(overrides)) fail('INVALID_OVERRIDE', 'Expected boolean per-session overrides.');
  const resolved = resolveGroups(policy);
  const skills = sortedCatalog(catalog);
  const names = new Set(skills.map(skill => skill.name));
  for (const [name, value] of Object.entries(overrides)) {
    skillName(name);
    if (!names.has(name)) fail('UNKNOWN_SKILL', `Cannot select undiscovered skill ${name}.`);
    if (typeof value !== 'boolean') fail('INVALID_OVERRIDE', 'Overrides must be true or false.');
  }
  const rows = skills.map(skill => {
    const group = resolved.groups[skill.name] ?? resolved.defaultGroup;
    return {
      name: skill.name,
      group,
      selected: own(overrides, skill.name) ? overrides[skill.name] : group === 'common',
      binding: binding(skill),
    };
  });
  const catalogRevision = hash(skills.map(skill => [skill.name, binding(skill)]));
  return freeze({ version: 1, sessionId, workspaceKey, catalogRevision, rows });
}

/**
 * Commit ONLY through a trusted UI/CLI action before the first model step. Atomically
 * persist this result and block turn admission until the write succeeds. An explicit
 * empty selection is valid and never means "use defaults".
 */
export function confirmSelection({ draft, catalog, complete, now = new Date().toISOString() }) {
  if (!record(draft) || draft.version !== 1 || !Array.isArray(draft.rows) ||
      typeof draft.sessionId !== 'string' || !draft.sessionId ||
      typeof draft.workspaceKey !== 'string' || !draft.workspaceKey ||
      typeof draft.catalogRevision !== 'string' || typeof now !== 'string' || !Number.isFinite(Date.parse(now))) {
    fail('INVALID_DRAFT', 'Invalid session draft.');
  }
  if (complete !== true) fail('INCOMPLETE_CATALOG', 'Cannot confirm incomplete discovery.');
  const skills = sortedCatalog(catalog);
  const revision = hash(skills.map(skill => [skill.name, binding(skill)]));
  if (revision !== draft.catalogRevision) fail('STALE_DRAFT', 'Catalog changed; refresh the configuration panel.');
  if (draft.rows.length !== skills.length) fail('INVALID_DRAFT', 'Draft is not a complete catalog selection.');
  const selected = [];
  for (let i = 0; i < skills.length; i++) {
    const row = draft.rows[i];
    if (!record(row) || row.name !== skills[i].name || row.binding !== binding(skills[i]) ||
        typeof row.selected !== 'boolean' || !['common', 'optional'].includes(row.group)) {
      fail('INVALID_DRAFT', 'Draft rows do not match the displayed catalog.');
    }
    if (row.selected) selected.push({ name: row.name, binding: row.binding });
  }
  return freeze({
    version: 1, sessionId: draft.sessionId, workspaceKey: draft.workspaceKey,
    confirmedAt: now, catalogRevision: revision, selected,
  });
}

/** Validate persisted snapshots at the storage boundary, including explicit-empty state. */
export function restoreSelection(value) {
  if (!record(value) || value.version !== 1 || typeof value.sessionId !== 'string' || !value.sessionId ||
      typeof value.workspaceKey !== 'string' || !value.workspaceKey || typeof value.confirmedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.confirmedAt)) ||
      typeof value.catalogRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.catalogRevision) ||
      !Array.isArray(value.selected)) {
    fail('INVALID_SNAPSHOT', 'Invalid or unsupported persisted skill selection.');
  }
  const names = new Set();
  const selected = value.selected.map(item => {
    if (!record(item)) fail('INVALID_SNAPSHOT', 'Invalid selected skill binding.');
    skillName(item.name);
    if (names.has(item.name) || typeof item.binding !== 'string' || !/^[a-f0-9]{64}$/.test(item.binding)) {
      fail('INVALID_SNAPSHOT', 'Duplicate or invalid selected skill binding.');
    }
    names.add(item.name);
    return { name: item.name, binding: item.binding };
  });
  return freeze({
    version: 1, sessionId: value.sessionId, workspaceKey: value.workspaceKey,
    confirmedAt: value.confirmedAt, catalogRevision: value.catalogRevision, selected,
  });
}

/** Fail closed on unconfigured, wrong-session, and wrong-workspace use. */
function checkedScope(snapshot, scope) {
  if (!snapshot) fail('UNCONFIGURED', 'Confirm session skills before starting the model.');
  const safe = restoreSelection(snapshot);
  if (safe.sessionId !== scope?.sessionId || safe.workspaceKey !== scope?.workspaceKey) {
    fail('SCOPE_MISMATCH', 'Skill selection belongs to another session or workspace.');
  }
  return safe;
}

/** Never use this filtered view for the configuration UI; that UI needs the raw registry. */
export function modelCatalog({ snapshot, scope, catalog, complete }) {
  const safe = checkedScope(snapshot, scope);
  if (complete !== true) fail('INCOMPLETE_CATALOG', 'Retry or preserve the previous filtered catalog.');
  const selected = new Map(safe.selected.map(item => [item.name, item.binding]));
  return sortedCatalog(catalog).filter(skill => selected.get(skill.name) === binding(skill) &&
    skill.invocation.modelInvocable).map(skill => ({ name: skill.name, description: skill.description }));
}

/**
 * Invoke twice: before provider.get() against the summary, and after provider.get()
 * against the returned definition. No skill content should be emitted between checks.
 */
export function assertSkillAccess({ snapshot, scope, skill, caller }) {
  if (caller !== 'model' && caller !== 'user') fail('INVALID_CALLER', 'Caller must be model or user.');
  const safe = checkedScope(snapshot, scope);
  validateSkill(skill);
  const selected = safe.selected.find(item => item.name === skill.name);
  if (!selected) fail('NOT_SELECTED', 'This skill is not enabled in this session.');
  if (selected.binding !== binding(skill)) fail('SKILL_CHANGED', 'Selected skill metadata changed; start a new configured session.');
  const allowed = caller === 'model' ? skill.invocation.modelInvocable : skill.invocation.userInvocable;
  if (!allowed) fail('INVOCATION_DISABLED', 'The provider does not permit this invocation mode.');
}

/** Serialize only enabled summaries. Do not emit disabled counts, names, or descriptions. */
export function renderModelCatalog(entries, maxDescriptionLength = 500) {
  if (!Number.isInteger(maxDescriptionLength) || maxDescriptionLength < 3) {
    fail('INVALID_LIMIT', 'Description bound must be an integer of at least 3.');
  }
  if (!Array.isArray(entries)) fail('INVALID_CATALOG', 'Expected model catalog entries.');
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const lines = entries.map(entry => {
    skillName(entry?.name);
    if (typeof entry.description !== 'string') fail('INVALID_CATALOG', 'Invalid description.');
    const normalized = entry.description.replace(/\s+/gu, ' ').trim();
    const chars = Array.from(normalized);
    const bounded = chars.length > maxDescriptionLength
      ? chars.slice(0, maxDescriptionLength - 1).join('') + '…' : normalized;
    return `- \`${entry.name}\`: ${escape(bounded)}`;
  });
  return ['<available_skills>', ...lines, '</available_skills>'].join('\n');
}
