/** Cordis adapter. Uses public scoped registration, pre-step waterfall, and human commands. */
import { SessionSkillController } from './controller.mjs';
import { commandHandler } from './commands.mjs';
import { fail, renderModelCatalog } from './policy.mjs';

export const CATALOG_OWNER = 'rocloud1999/session-skill-switch/v1';
function explicitNames(messages) {
  const names = new Set();
  for (const message of messages) {
    if (message.source?.kind !== 'user') continue;
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/.exec(text);
    if (match) names.add(match[1]);
  }
  return [...names];
}
function catalogReader() {
  const caches = new WeakMap();
  return agent => {
    const session = agent.session;
    let cache = caches.get(session);
    if (!cache || cache.next > session.seq) cache = { next: 0, records: [] };
    for (let n = cache.next; n < session.seq; n++) {
      const event = session.eventAt(n), source = event?.data?.source;
      if (event?.type === 'user/message' && source?.kind === 'skill-catalog' &&
          source.owner === CATALOG_OWNER && Array.isArray(source.entries) &&
          source.entries.every(entry => entry && typeof entry.name === 'string' && typeof entry.description === 'string')) {
        cache.records.push({ seq: event.seq, entries: source.entries });
      }
    }
    cache.next = session.seq; caches.set(session, cache);
    const visible = new Set(session.surface.nodes);
    for (let n = cache.records.length - 1; n >= 0; n--) if (visible.has(cache.records[n].seq)) return cache.records[n].entries;
    return undefined;
  };
}
function normalizeEntries(entries, max) {
  return entries.map(({ name, description }) => {
    const chars = Array.from(description.replace(/\s+/gu, ' ').trim());
    return { name, description: chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('') };
  });
}
export function install(ctx, config, { createUserMessage, renderSkillContent }) {
  const limit = config.catalogDescriptionMaxLength ?? 500;
  if (!Number.isInteger(limit) || limit < 3 || limit > 10000) fail('INVALID_CONFIG', 'catalogDescriptionMaxLength must be between 3 and 10000.');
  const controller = new SessionSkillController(agent => agent.ctx.skills, config);
  const mounted = new Map(), lifetime = new AbortController(), visibleCatalog = catalogReader();
  function mount(agent) {
    if (mounted.has(agent)) return mounted.get(agent);
    const registry = agent.ctx.tools;
    const original = registry.get('skill', agent);
    // Do not create a new model capability in a preset that deliberately has no skill tool.
    if (!original) { const entry = { tool: undefined, dispose() {} }; mounted.set(agent, entry); return entry; }
    const tool = { ...original, async execute(args, exec) {
      if (exec.agent !== agent) fail('SCOPE_MISMATCH', 'Skill loader belongs to another agent.');
      const signal = AbortSignal.any([exec.signal, lifetime.signal]);
      const skill = await controller.load(agent, args?.name, 'model', signal);
      return { name: skill.name, provider: skill.provider, content: skill.content,
        ...(skill.resourceBase === undefined ? {} : { resourceBase: { ...skill.resourceBase } }) };
    } };
    // Both owners retain the disposer: Agent teardown and bundle unload are independent.
    const dispose = agent.ctx.effect(() => registry.register(tool), 'session-skill-switch.loader');
    const entry = { tool, dispose }; mounted.set(agent, entry); return entry;
  }
  ctx.effect(() => () => {
    lifetime.abort(new Error('Session skill switch unloaded.'));
    for (const entry of mounted.values()) entry.dispose();
    mounted.clear();
  }, 'session-skill-switch.lifetime');
  ctx.on('agent/created', ({ agent }) => { mount(agent); });
  ctx.on('agent/disposed', ({ agent }) => { mounted.get(agent)?.dispose(); mounted.delete(agent); });
  for (const agent of ctx.agents.list()) mount(agent);

  ctx.commands.register({
    name: 'session-skills', definitionId: '@rocloud1999/dsh-session-skill-switch',
    description: 'Configure session skills before the first model request / 会话技能选择',
    input: { hint: 'status | confirm [+name] [-name] | none | common <name...> | optional <name...>' },
    handler: commandHandler(controller, lifetime.signal),
  });

  // prepend makes this the outside wrapper of the stock skill consumer. Stock messages
  // are replaced BEFORE admission/logging, not redacted from an already-built LLM request.
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const combined = AbortSignal.any([signal, lifetime.signal]);
    const { tool } = mount(agent);
    let prepared;
    try { prepared = await controller.prepare(agent, combined); }
    catch (error) {
      if (error.code === 'UNCONFIGURED') return { kind: 'reject' };
      throw error;
    }
    const injections = [];
    for (const name of explicitNames(messages)) {
      const summary = prepared.snapshot.skills.find(skill => skill.name === name);
      // Match the native consumer: unknown/user-disabled slash tokens stay ordinary prose.
      if (!summary?.invocation.userInvocable) continue;
      const skill = await controller.load(agent, name, 'user', combined);
      injections.push(createUserMessage({ content: [{ type: 'text', text: renderSkillContent(skill) }],
        source: { kind: 'skill-invocation', name, form: 'instructions', owner: CATALOG_OWNER } }));
    }
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    combined.throwIfAborted();
    const resolved = agent.ctx.tools.get('skill', agent);
    if (resolved !== tool && resolved !== undefined) fail('COMPETING_SKILL_LOADER', 'Another plugin replaced the session skill loader. Review composition before continuing.');
    const entries = normalizeEntries(resolved && tool ? prepared.entries : [], limit);
    const filtered = decision.messages.filter(message => !['skill-catalog', 'skill-invocation'].includes(message.source?.kind));
    const previous = visibleCatalog(agent);
    if (JSON.stringify(previous) !== JSON.stringify(entries) && (entries.length > 0 || previous !== undefined)) {
      filtered.push(createUserMessage({
        content: [{ type: 'text', text: ['<system-reminder>',
          'Only the following skills are enabled for this session. This list replaces earlier skill catalogs.',
          renderModelCatalog(entries, limit),
          'For a task matching a listed skill, call the skill tool before taking task actions. Load full instructions before following them.',
          'A user-invoked <skill_content> block is already loaded; do not load it again.', '</system-reminder>'].join('\n') }],
        source: { kind: 'skill-catalog', form: 'catalog', owner: CATALOG_OWNER, entries, ...(previous === undefined ? {} : { update: true }) },
      }));
    }
    await controller.seal(agent, prepared.state, combined);
    return { ...decision, messages: [...filtered, ...injections] };
  }, { prepend: true });
  return controller;
}
