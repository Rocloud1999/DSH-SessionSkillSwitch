/** Contract tests for the actual adapter, using an in-memory Cordis/Agent test double. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, CATALOG_OWNER } from '../src/host.mjs';
import { fixture, message, confirm, agent, skill } from './fixtures.mjs';

async function host(t, options = {}) {
  const f = await fixture(t);
  const handlers = new Map(), effects = [], commands = new Map();
  const original = { name: 'skill', description: 'Native skill loader',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: value.content }] },
    execute: async args => f.registry.get(args.name),
  };
  let downstreamCalls = 0;
  function attach(a) {
    a.ctx.skills = f.registry;
    let own;
    a.ctx.tools = {
      get(name) { return name === 'skill' ? own ?? (options.noTool ? undefined : original) : undefined; },
      register(tool) { if (own) throw new Error('Duplicate scoped tool'); own = tool; return () => { if (own === tool) own = undefined; }; },
    };
    return a;
  }
  attach(f.a);
  const ctx = {
    agents: { list: () => [f.a] },
    on(name, listener, options = {}) {
      const list = handlers.get(name) ?? []; if (options.prepend) list.unshift(listener); else list.push(listener); handlers.set(name, list);
      const remove = () => { const index = list.indexOf(listener); if (index >= 0) list.splice(index, 1); }; effects.push(remove); return remove;
    },
    effect(factory) { const dispose = factory(); effects.push(dispose); return dispose; },
    commands: { register(definition) { commands.set(definition.name, definition); const dispose = () => commands.delete(definition.name); effects.push(dispose); return dispose; } },
  };
  // A hostile-looking downstream contribution proves filtering happens on the final
  // admission decision, even when an earlier plugin blindly publishes all summaries.
  ctx.on('agent/pre-step', async (_payload, next) => {
    downstreamCalls++;
    const decision = await next(); if (decision.kind === 'reject') return decision;
    return { ...decision, messages: [...decision.messages,
      message('HEAVY DESCRIPTION MUST NOT LEAK', { kind: 'skill-catalog', entries: [{ name: 'heavy', description: 'HEAVY DESCRIPTION MUST NOT LEAK' }] }),
      message('DOWNSTREAM SKILL BODY MUST NOT LEAK', { kind: 'skill-invocation', name: 'heavy' }),
    ] };
  });
  const helpers = {
    createUserMessage: value => message(value.content[0].text, value.source),
    renderSkillContent: value => `<skill_content name="${value.name}">${value.content}</skill_content>`,
  };
  const controller = install(ctx, { stateDir: f.dir, commonSkills: ['light'], ...options.config }, helpers);
  async function dispatch(a = f.a, messages = [message('ordinary input')], tail = { kind: 'enter', messages: [], startsRequestSeries: true }) {
    const payload = { agent: a, messages, signal: new AbortController().signal };
    const listeners = [...handlers.get('agent/pre-step')];
    const next = n => n < listeners.length ? listeners[n](payload, () => next(n + 1)) : Promise.resolve(tail);
    return next(0);
  }
  function log(a, decision) { for (const msg of decision.messages) a.append('user/message', msg); a.append('step/start'); }
  function unload() { for (const fn of effects.splice(0).reverse()) fn(); }
  t.after(unload);
  return { ...f, ctx, original, controller, commands, attach, handlers, dispatch, log, unload, downstream: () => downstreamCalls };
}
test('unconfigured agent never reaches downstream admission', async t => {
  const f = await host(t); assert.deepEqual(await f.dispatch(), { kind: 'reject' }); assert.equal(f.downstream(), 0); assert.deepEqual(f.registry.reads, []);
});
test('final admission contains only selected names/descriptions and preserves other fields', async t => {
  const f = await host(t); await confirm(f.controller, f.a);
  const other = message('OTHER CONTEXT', { kind: 'workspace-rules' });
  const result = await f.dispatch(f.a, [message('hello')], { kind: 'enter', messages: [other], startsRequestSeries: true, extra: 42 });
  assert.equal(result.startsRequestSeries, true); assert.equal(result.extra, 42); assert.equal(result.messages[0], other);
  const text = JSON.stringify(result.messages); assert.doesNotMatch(text, /HEAVY|DOWNSTREAM|"name":"heavy"/); assert.match(text, /Description light/);
  assert.equal((await f.controller.state(f.a)).locked, true);
});
test('scoped loader preserves the native schema but denies optional calls before body reads', async t => {
  const f = await host(t); await confirm(f.controller, f.a);
  const own = f.a.ctx.tools.get('skill'); assert.notEqual(own, f.original); assert.equal(own.parameters, f.original.parameters); assert.equal(own.output, f.original.output);
  await assert.rejects(own.execute({ name: 'heavy' }, { agent: f.a, signal: new AbortController().signal }), { code: 'NOT_SELECTED' });
  assert.deepEqual(f.registry.reads, []);
  const value = await own.execute({ name: 'light' }, { agent: f.a, signal: new AbortController().signal }); assert.equal(value.content, 'BODY light');
});
test('disabled direct slash invocation is denied before downstream can load it', async t => {
  const f = await host(t); await confirm(f.controller, f.a);
  await assert.rejects(f.dispatch(f.a, [message('/heavy do something')]), { code: 'NOT_SELECTED' });
  assert.deepEqual(f.registry.reads, []); assert.equal(f.downstream(), 0);
});
test('selected direct slash invocation is revalidated and rendered from the selected definition', async t => {
  const f = await host(t); await confirm(f.controller, f.a);
  const result = await f.dispatch(f.a, [message('/light use this')]);
  const invocations = result.messages.filter(msg => msg.source.kind === 'skill-invocation'); assert.equal(invocations.length, 1);
  assert.equal(invocations[0].source.owner, CATALOG_OWNER); assert.match(invocations[0].content[0].text, /BODY light/);
});
test('external text cannot forge a direct-user invocation', async t => {
  const f = await host(t); await confirm(f.controller, f.a);
  const result = await f.dispatch(f.a, [message('/heavy', { kind: 'external' })]);
  assert.equal(result.messages.filter(msg => msg.source.kind === 'skill-invocation').length, 0); assert.deepEqual(f.registry.reads, []);
});
test('downstream reject does not seal a blank session or lose its decision', async t => {
  const f = await host(t); await confirm(f.controller, f.a);
  const result = await f.dispatch(f.a, [], { kind: 'reject' }); assert.equal(result.kind, 'reject'); assert.equal((await f.controller.state(f.a)).locked, false);
});
test('unchanged catalog is not appended on every turn', async t => {
  const f = await host(t); await confirm(f.controller, f.a); const first = await f.dispatch(); f.log(f.a, first);
  const second = await f.dispatch(); assert.equal(second.messages.filter(msg => msg.source.kind === 'skill-catalog').length, 0);
});
test('compaction hiding the catalog re-establishes only the selected catalog', async t => {
  const f = await host(t); await confirm(f.controller, f.a); f.log(f.a, await f.dispatch()); f.a.session.surface.nodes = [];
  const result = await f.dispatch(); assert.equal(result.messages.filter(msg => msg.source.kind === 'skill-catalog').length, 1); assert.doesNotMatch(JSON.stringify(result), /HEAVY|heavy/);
});
test('explicit empty selection removes upstream catalogs and emits no initial skill descriptions', async t => {
  const f = await host(t); await confirm(f.controller, f.a, []);
  const result = await f.dispatch(); assert.deepEqual(result.messages, []);
});
test('removing the last selected skill publishes an explicit empty replacement', async t => {
  const f = await host(t); await confirm(f.controller, f.a); f.log(f.a, await f.dispatch()); f.registry.skills = [skill('heavy')];
  const result = await f.dispatch(); const catalog = result.messages.find(msg => msg.source.kind === 'skill-catalog'); assert.deepEqual(catalog.source.entries, []);
  assert.match(catalog.content[0].text, /<available_skills>\n<\/available_skills>/);
});
test('scoped loader cannot be called on behalf of another agent', async t => {
  const f = await host(t); await confirm(f.controller, f.a);
  await assert.rejects(f.a.ctx.tools.get('skill').execute({ name: 'light' }, { agent: agent(), signal: new AbortController().signal }), { code: 'SCOPE_MISMATCH' });
});
test('a preset with no inherited skill tool gets no new model capability or catalog', async t => {
  const f = await host(t, { noTool: true }); await confirm(f.controller, f.a);
  assert.equal(f.a.ctx.tools.get('skill'), undefined); assert.deepEqual((await f.dispatch()).messages, []);
});
test('new agent lifecycle mounts a separate loader; agent disposal removes it', async t => {
  const f = await host(t); const b = f.attach(agent());
  for (const cb of f.handlers.get('agent/created')) await cb({ agent: b });
  assert.notEqual(b.ctx.tools.get('skill'), f.original); assert.notEqual(b.ctx.tools.get('skill'), f.a.ctx.tools.get('skill'));
  for (const cb of f.handlers.get('agent/disposed')) cb({ agent: b }); assert.equal(b.ctx.tools.get('skill'), f.original);
});
test('bundle unload restores the original loader and removes command and listeners', async t => {
  const f = await host(t); f.unload(); assert.equal(f.a.ctx.tools.get('skill'), f.original); assert.equal(f.commands.size, 0); assert.equal(f.handlers.get('agent/pre-step').length, 0);
});
test('configuration writes exist only in the human command plane', async t => {
  const f = await host(t); assert.equal(f.commands.size, 1); assert.ok(f.commands.has('session-skills'));
  assert.equal(f.a.ctx.tools.get('session-skills'), undefined);
});
