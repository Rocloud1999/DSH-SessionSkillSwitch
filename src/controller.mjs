/** Human configuration operations and model boundaries. No model-call API is exposed here. */
import { resolve } from 'node:path';
import { JsonStore } from './storage.mjs';
import { assertSkillAccess, confirmSelection, createDraft, fail, modelCatalog,
  resolveGroups, restoreSelection, skillBinding, skillName } from './policy.mjs';

export class SessionSkillController {
  constructor(skillsFor, config = {}, store = new JsonStore(config.stateDir)) {
    if (typeof skillsFor !== 'function') throw new TypeError('skillsFor must resolve the calling agent registry.');
    this.skillsFor = skillsFor; this.store = store; this.history = new WeakMap();
    const common = config.commonSkills ?? [], optional = config.optionalSkills ?? [];
    if (!Array.isArray(common) || !Array.isArray(optional)) fail('INVALID_CONFIG', 'commonSkills and optionalSkills must be arrays.');
    const groups = {};
    for (const name of common) groups[skillName(name)] = 'common';
    for (const name of optional) {
      if (Object.hasOwn(groups, skillName(name))) fail('INVALID_CONFIG', 'A skill cannot be both common and optional.');
      groups[name] = 'optional';
    }
    this.basePolicy = resolveGroups({ groups });
  }
  scope(agent) {
    if (!agent?.session?.id || !agent.session.header) fail('INVALID_SCOPE', 'A live Harness session is required.');
    return { sessionId: agent.session.id, workspaceKey: resolve(agent.session.header.cwd ?? process.cwd()) };
  }
  lookup(agent, signal) { return { cwd: agent.session.header.cwd, signal, scope: agent }; }
  /** Incremental inspection, never a full-log rescan on each turn. Forks count as existing history. */
  started(agent) {
    const session = agent.session;
    if (!Number.isSafeInteger(session.seq) || typeof session.eventAt !== 'function') fail('INCOMPATIBLE_HARNESS', 'Session eventAt/seq API is required.');
    let cache = this.history.get(session);
    if (!cache || cache.seq > session.seq) cache = { seq: 0, started: false };
    if (!cache.started) for (let n = cache.seq; n < session.seq; n++) {
      const event = session.eventAt(n);
      if (!event) fail('INCOMPATIBLE_HARNESS', 'Cannot read the complete session log.');
      if (['step/start', 'assistant/message', 'assistant/attempt', 'tool/result'].includes(event.type)) { cache.started = true; break; }
    }
    cache.seq = session.seq; this.history.set(session, cache); return cache.started;
  }
  async state(agent) {
    const scope = this.scope(agent), state = await this.store.read('session', scope.sessionId);
    if (state && (state.selection.sessionId !== scope.sessionId || state.selection.workspaceKey !== scope.workspaceKey)) fail('SCOPE_MISMATCH', 'Saved selection belongs to a different session or workspace.');
    return state;
  }
  async catalog(agent, signal) {
    signal?.throwIfAborted();
    const snapshot = await this.skillsFor(agent).snapshot(this.lookup(agent, signal));
    signal?.throwIfAborted();
    if (snapshot.complete !== true) fail('INCOMPLETE_CATALOG', 'Skill discovery is incomplete. Refresh before continuing.');
    return snapshot;
  }
  async policy() {
    const saved = await this.store.read('groups');
    return { revision: saved?.revision ?? 0, policy: resolveGroups(this.basePolicy, saved?.groups ?? {}) };
  }
  async inspect(agent, signal) {
    const scope = this.scope(agent);
    const [state, snapshot, groups] = await Promise.all([this.state(agent), this.catalog(agent, signal), this.policy()]);
    const selected = new Map(state?.selection.selected.map(row => [row.name, row.binding]) ?? []);
    const overrides = state ? Object.fromEntries(snapshot.skills.map(skill => [skill.name, selected.get(skill.name) === skillBinding(skill)])) : {};
    const draft = createDraft({ ...scope, catalog: snapshot.skills, complete: true, policy: groups.policy, overrides });
    const summaries = new Map(snapshot.skills.map(skill => [skill.name, skill]));
    return {
      protocol: 1, sessionId: scope.sessionId, stateRevision: state?.revision ?? 0, groupRevision: groups.revision,
      catalogRevision: draft.catalogRevision, confirmed: Boolean(state), locked: state?.locked === true || this.started(agent),
      legacy: !state && this.started(agent),
      rows: draft.rows.map(row => ({ ...row, description: summaries.get(row.name).description,
        source: summaries.get(row.name).source, provider: summaries.get(row.name).provider,
        modelInvocable: summaries.get(row.name).invocation.modelInvocable, userInvocable: summaries.get(row.name).invocation.userInvocable,
        changed: selected.has(row.name) && selected.get(row.name) !== row.binding })),
    };
  }
  async confirm(agent, request, signal) {
    if (typeof agent.runMaintenance !== 'function') fail('INCOMPATIBLE_HARNESS', 'Agent.runMaintenance is required for atomic pre-start configuration.');
    return agent.runMaintenance(async maintenanceSignal => {
      const combined = signal ? AbortSignal.any([signal, maintenanceSignal]) : maintenanceSignal;
      combined.throwIfAborted();
      const view = await this.inspect(agent, combined);
      if (view.locked) fail('SESSION_STARTED', 'The first model step has already started. Create a new session to change skills.');
      if (request.stateRevision !== view.stateRevision || request.groupRevision !== view.groupRevision) fail('STALE_STATE', 'Configuration changed. Refresh and select again.');
      if (request.catalogRevision !== view.catalogRevision) fail('STALE_DRAFT', 'Skill catalog changed. Refresh and select again.');
      if (!Array.isArray(request.selected) || new Set(request.selected).size !== request.selected.length) fail('INVALID_SELECTION', 'selected must be an array of unique skill names.');
      const names = new Set(view.rows.map(row => row.name));
      for (const name of request.selected) if (!names.has(skillName(name))) fail('UNKNOWN_SKILL', 'Cannot select an undiscovered skill.');
      const selected = new Set(request.selected), snapshot = await this.catalog(agent, combined);
      const groups = await this.policy();
      if (groups.revision !== request.groupRevision) fail('STALE_STATE', 'Classification changed. Refresh and select again.');
      const draft = createDraft({ ...this.scope(agent), catalog: snapshot.skills, complete: true, policy: groups.policy,
        overrides: Object.fromEntries(snapshot.skills.map(skill => [skill.name, selected.has(skill.name)])) });
      if (draft.catalogRevision !== request.catalogRevision) fail('STALE_DRAFT', 'Skill catalog changed while confirming.');
      const selection = confirmSelection({ draft, catalog: snapshot.skills, complete: true });
      const saved = await this.store.update('session', view.sessionId, view.stateRevision, current => {
        if (current?.locked || this.started(agent)) fail('SESSION_STARTED', 'Session skills are already locked.');
        return { locked: false, selection };
      }, combined);
      return { ...view, confirmed: true, locked: false, stateRevision: saved.revision,
        rows: view.rows.map(row => ({ ...row, selected: selected.has(row.name), changed: false })) };
    });
  }
  async classify(agent, request, signal) {
    if (!['common', 'optional'].includes(request.group) || !Array.isArray(request.names) || request.names.length === 0) fail('INVALID_CONFIG', 'Choose common or optional and at least one name.');
    const catalog = await this.catalog(agent, signal), names = new Set(catalog.skills.map(skill => skill.name));
    for (const name of request.names) if (!names.has(skillName(name))) fail('UNKNOWN_SKILL', 'Cannot classify an undiscovered skill.');
    if (!Number.isSafeInteger(request.groupRevision) || request.groupRevision < 0) fail('INVALID_CONFIG', 'A group revision is required.');
    await this.store.update('groups', undefined, request.groupRevision, current => ({
      groups: { ...current?.groups, ...Object.fromEntries(request.names.map(name => [name, request.group])) },
    }), signal);
    return this.inspect(agent, signal);
  }
  /** Delegated agents inherit only an intersection, never newly discovered/common skills. Normal forks do not inherit. */
  async inheritSubagent(agent, snapshot, signal) {
    const { origin, parentSession } = agent.session.header;
    if (origin !== 'subagent' || !parentSession) return undefined;
    const parent = await this.store.read('session', parentSession);
    if (!parent?.locked) fail('UNCONFIGURED', 'The parent session must be configured before delegating.');
    const allowed = new Map(parent.selection.selected.map(item => [item.name, item.binding]));
    const draft = createDraft({ ...this.scope(agent), catalog: snapshot.skills, complete: true, policy: {},
      overrides: Object.fromEntries(snapshot.skills.map(skill => [skill.name, allowed.get(skill.name) === skillBinding(skill)])) });
    const selection = confirmSelection({ draft, catalog: snapshot.skills, complete: true });
    return this.store.update('session', agent.session.id, 0, () => ({ locked: true, selection }), signal);
  }
  async prepare(agent, signal) {
    const snapshot = await this.catalog(agent, signal);
    let state = await this.state(agent);
    if (!state) state = await this.inheritSubagent(agent, snapshot, signal);
    if (!state) fail('UNCONFIGURED', this.started(agent)
      ? 'This existing conversation predates the switch. Create a new session.'
      : 'Confirm session skills in the composer panel or /session-skills confirm before sending a message.');
    return { state, snapshot, entries: modelCatalog({ snapshot: state.selection, scope: this.scope(agent), catalog: snapshot.skills, complete: true }) };
  }
  /** Persist the start fence before any admitted messages can become a model request. */
  async seal(agent, state, signal) {
    if (state.locked) return state;
    return this.store.update('session', agent.session.id, state.revision, current => {
      if (!current) fail('UNCONFIGURED', 'Session selection disappeared.');
      return { locked: true, selection: current.selection };
    }, signal);
  }
  async load(agent, name, caller, signal) {
    skillName(name);
    const state = await this.state(agent), scope = this.scope(agent);
    if (!state) fail('UNCONFIGURED', 'Confirm session skills before invoking them.');
    // This check happens before discovery and, most importantly, before any provider body read.
    if (!state.selection.selected.some(item => item.name === name)) fail('NOT_SELECTED', 'This skill is not enabled for this session.');
    const snapshot = await this.catalog(agent, signal), summary = snapshot.skills.find(item => item.name === name);
    if (!summary) fail('UNKNOWN_SKILL', 'The selected skill is no longer available.');
    assertSkillAccess({ snapshot: state.selection, scope, skill: summary, caller });
    const skill = await this.skillsFor(agent).get(name, this.lookup(agent, signal));
    signal?.throwIfAborted();
    if (!skill || skill.name !== name) fail('UNKNOWN_SKILL', 'The selected skill is no longer available.');
    assertSkillAccess({ snapshot: state.selection, scope, skill, caller });
    return skill;
  }
}
