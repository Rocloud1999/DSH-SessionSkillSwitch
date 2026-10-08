import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionSkillController } from '../src/controller.mjs';
import { JsonStore } from '../src/storage.mjs';
export function skill(name, extra = {}) {
  return { name, description: `Description ${name}`, source: 'user-dsh', provider: 'filesystem',
    path: `/skills/${name}/SKILL.md`, invocation: { modelInvocable: true, userInvocable: true }, ...extra };
}
export function agent(id = randomUUID(), extra = {}) {
  const events = [], listeners = [];
  let maintenance = false;
  const session = { id, header: { cwd: '/workspace', ...extra }, surface: { nodes: [] },
    get seq() { return events.length; }, eventAt(n) { return events[n]; } };
  return { id, session, events, status: 'idle',
    append(type, data = {}) { const event = { type, data, seq: events.length }; events.push(event); session.surface.nodes.push(event.seq); return event; },
    async runMaintenance(task) {
      if (maintenance || this.status !== 'idle') throw new Error('Agent is not idle.');
      maintenance = true;
      try { return await task(new AbortController().signal); } finally { maintenance = false; }
    },
    ctx: { effect(factory) { const release = factory(); listeners.push(release); return release; } },
    dispose() { for (const fn of listeners) fn(); },
  };
}
export async function fixture(t, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sss-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const registry = { skills: [skill('heavy'), skill('light')], complete: true, reads: [], options: [],
    async snapshot(options) { this.options.push(options); return { skills: this.skills.map(row => ({ ...row })), complete: this.complete }; },
    async get(name, options) { this.reads.push(name); this.options.push(options);
      const summary = this.skills.find(row => row.name === name);
      return this.getOverride ? this.getOverride(name, options) : summary && { ...summary, content: `BODY ${name}` }; },
  };
  const store = new JsonStore(dir), controller = new SessionSkillController(() => registry, { commonSkills: ['light'], ...config }, store);
  const a = agent(); a.ctx.skills = registry;
  return { dir, registry, store, controller, a };
}
export async function confirm(controller, a, selected = ['light']) {
  const view = await controller.inspect(a);
  return controller.confirm(a, { ...view, selected });
}
export function message(text, source = { kind: 'user' }) { return { id: randomUUID(), content: [{ type: 'text', text }], source }; }
