/** The only write surface is the Harness human-command plane, not an agent tool. */
import { fail, skillName } from './policy.mjs';
const MAX_INPUT = 256 * 1024;
function human(view) {
  const heading = view.legacy ? '此会话已有模型历史，请新建会话。' : view.locked ? '本次会话选择已锁定。' : view.confirmed ? '已确认；首次模型请求前仍可修改。' : '尚未确认；模型请求将被阻止。';
  return [heading, ...view.rows.map(row => `${row.selected ? '[x]' : '[ ]'} ${row.name} (${row.group === 'common' ? '常用' : '可选'})${row.changed ? ' [元数据已变化]' : ''}`),
    '', '/session-skills confirm [+name] [-name]  确认选择', '/session-skills none  不启用任何技能',
    '/session-skills common <name...>  设为常用', '/session-skills optional <name...>  设为可选'].join('\n');
}
export function commandHandler(controller, lifetimeSignal) {
  return async ({ agent, rawInput = '', signal }) => {
    const combined = signal ? AbortSignal.any([signal, lifetimeSignal]) : lifetimeSignal;
    const text = rawInput.trim(), structured = text.startsWith('{');
    try {
      if (text.length > MAX_INPUT) fail('INVALID_INPUT', 'Command input is too large.');
      let view;
      if (structured) {
        const request = JSON.parse(text);
        if (request.action === 'inspect') view = await controller.inspect(agent, combined);
        else if (request.action === 'confirm') view = await controller.confirm(agent, request, combined);
        else if (request.action === 'classify') view = await controller.classify(agent, request, combined);
        else fail('INVALID_ACTION', 'Unknown session skill operation.');
      } else {
        const [action = 'status', ...args] = text.split(/\s+/).filter(Boolean);
        view = await controller.inspect(agent, combined);
        if (action === 'common' || action === 'optional') {
          view = await controller.classify(agent, { names: args, group: action, groupRevision: view.groupRevision }, combined);
        } else if (action === 'confirm' || action === 'none') {
          if (action === 'none' && args.length) fail('INVALID_INPUT', 'none takes no arguments.');
          const selected = new Set(action === 'none' ? [] : view.rows.filter(row => row.selected).map(row => row.name));
          for (const arg of args) {
            if (!/^[+-]/.test(arg)) fail('INVALID_INPUT', 'Use +name to enable or -name to disable.');
            const name = skillName(arg.slice(1));
            if (!view.rows.some(row => row.name === name)) fail('UNKNOWN_SKILL', 'Unknown skill.');
            if (arg[0] === '+') selected.add(name); else selected.delete(name);
          }
          view = await controller.confirm(agent, { ...view, selected: [...selected] }, combined);
        } else if (!['status', 'help'].includes(action)) fail('INVALID_ACTION', 'Use status, confirm, none, common, or optional.');
      }
      return { kind: 'success', text: structured ? JSON.stringify(view) : human(view) };
    } catch (error) {
      return { kind: 'error', text: `${error.code ?? 'SESSION_SKILLS_ERROR'}: ${error.message}` };
    }
  };
}
