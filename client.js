/* Plain-JS lazy Client module: React is supplied by Harness, not bundled twice. */
window.__ModuleLoader__.load({
  id: '@rocloud1999/dsh-session-skill-switch',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const NS = 'session-skill-switch';
    const dictionaries = {
      zh: {
        title: '会话技能', configure: '配置本次会话技能', ready: '已配置技能', required: '请先配置技能',
        intro: '常用技能默认勾选，可选技能需要手动开启。只有本次勾选的技能描述会进入模型目录。',
        categories: '分类会保存到当前 Harness profile，影响后续新会话；勾选只影响本次会话。',
        common: '常用技能', optional: '可选技能', group: '分类', selection: '本次启用', search: '搜索技能名称或描述',
        refresh: '刷新', close: '关闭', confirm: '确认本次会话', defaults: '恢复常用默认', none: '全不选',
        loading: '正在读取技能目录…', locked: '本次选择已锁定。修改技能组合请新建会话；分类仍可调整。',
        legacy: '此会话已有模型历史，不能撤回先前加载的技能。请新建会话后配置。',
        empty: '没有匹配的技能。', pending: '尚未确认；发送消息不会发起模型请求。',
        selected: '已选', modelOnly: '仅模型可调用', userOnly: '仅手动调用', neither: '提供方禁止调用',
        changed: '元数据已变化，已停用；请新建会话重新选择。', all: '总计', error: '配置失败',
        unavailable: '配置不可用；请检查 Host 插件是否已启用。', saved: '已保存。现在可以发送消息。',
      },
      en: {
        title: 'Session skills', configure: 'Configure session skills', ready: 'Skills configured', required: 'Configure skills first',
        intro: 'Common skills start checked. Optional skills require an explicit choice. Only selected descriptions enter the model catalog.',
        categories: 'Categories are saved for this Harness profile and affect future sessions. Checkboxes affect this session only.',
        common: 'Common skills', optional: 'Optional skills', group: 'Category', selection: 'Enabled this session', search: 'Search skill names or descriptions',
        refresh: 'Refresh', close: 'Close', confirm: 'Confirm session', defaults: 'Common defaults', none: 'Select none',
        loading: 'Reading skill catalog…', locked: 'Selection is locked. Start a new session to change it. Categories remain editable.',
        legacy: 'This conversation already has model history. Previously loaded skills cannot be retracted. Configure a new session instead.',
        empty: 'No matching skills.', pending: 'Not confirmed. Sending a message will not start a model request.',
        selected: 'Selected', modelOnly: 'Model only', userOnly: 'Manual only', neither: 'Invocation disabled by provider',
        changed: 'Metadata changed; disabled. Re-select in a new session.', all: 'Total', error: 'Configuration failed',
        unavailable: 'Configuration is unavailable. Check that the Host plugin is enabled.', saved: 'Saved. You can now send a message.',
      },
    };
    const css = `
.dsh-sss {display:inline-flex;align-items:center;gap:8px;font:inherit;color:var(--dsw-alias-label-primary)}
.dsh-sss button,.dsh-sss input,.dsh-sss select{font:inherit;color:inherit}
.dsh-sss button,.dsh-sss select,.dsh-sss input[type=search]{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-specific-menu);padding:7px 10px}
.dsh-sss button{cursor:pointer}.dsh-sss button:disabled,.dsh-sss select:disabled{cursor:not-allowed;opacity:.55}
.dsh-sss button:focus-visible,.dsh-sss input:focus-visible,.dsh-sss select:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.dsh-sss .sss-trigger{font-size:12px;padding:3px 8px}.dsh-sss .sss-notice{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-sss dialog{box-sizing:border-box;width:min(780px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:22px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);font:inherit}
.dsh-sss dialog::backdrop{backdrop-filter:blur(3px)}
.dsh-sss .sss-heading,.dsh-sss .sss-footer,.dsh-sss .sss-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.dsh-sss h2{font-size:20px;margin:0}.dsh-sss h3{font-size:14px;margin:20px 0 8px}
.dsh-sss p{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:10px 0}
.dsh-sss .sss-search{min-width:150px;flex:1}.dsh-sss .sss-list{overflow:auto;max-height:48dvh;margin:12px 0}
.dsh-sss .sss-row{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:12px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-sss .sss-choice{display:flex;gap:10px;align-items:flex-start;min-width:0}.dsh-sss input[type=checkbox]{width:17px;height:17px;flex:none;margin:3px 0 0}
.dsh-sss .sss-name{display:block;font-weight:600;overflow-wrap:anywhere}.dsh-sss .sss-description{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;margin-top:3px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-sss .sss-meta{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
.dsh-sss .sss-row select{width:100%;align-self:start;font-size:12px}.dsh-sss .sss-error{border:1px solid currentColor;border-radius:8px;padding:10px;overflow-wrap:anywhere}
.dsh-sss .sss-footer{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}.dsh-sss .sss-confirm{font-weight:600;border:2px solid currentColor}
@media(max-width:480px){.dsh-sss dialog{padding:14px}.dsh-sss .sss-row{grid-template-columns:minmax(0,1fr) 100px}.dsh-sss .sss-toolbar{gap:6px}}
`;
    return {
      inject: ['slots', 'remote', 'remote.commands', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'session-skill-switch.locale');
        async function request(sessionId, value) {
          const result = await ctx.remote.commands.execute(sessionId, `/session-skills ${JSON.stringify(value)}`, []);
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
          const execution = result.value;
          if (!execution) throw new Error('Unknown /session-skills command; enable the Host bundle.');
          const outcome = execution.result;
          if (outcome.kind !== 'success') throw new Error(outcome.text || 'Session skill command failed.');
          const view = JSON.parse(outcome.text);
          if (view.protocol !== 1 || view.sessionId !== sessionId || !Array.isArray(view.rows)) throw new Error('Unsupported session skill response.');
          return view;
        }
        function Panel({ sessionId, t }) {
          const [view, setView] = React.useState(null), [selected, setSelected] = React.useState({});
          const [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false);
          const [error, setError] = React.useState(''), [query, setQuery] = React.useState(''), [notice, setNotice] = React.useState('');
          const dialog = React.useRef(null), active = React.useRef(true), working = React.useRef(false);
          const currentSelection = React.useRef({}), dirty = React.useRef(new Set());
          function adopt(next, preserve = false) {
            const choices = Object.fromEntries(next.rows.map(row => [row.name,
              preserve && dirty.current.has(row.name) ? currentSelection.current[row.name] === true : row.selected]));
            currentSelection.current = choices; setSelected(choices); setView(next);
            if (!preserve) dirty.current.clear();
          }
          async function run(operation, preserve = false) {
            if (working.current) return undefined;
            working.current = true; setBusy(true); setError(''); setNotice('');
            try {
              const next = await request(sessionId, operation);
              if (active.current) adopt(next, preserve);
              return next;
            } catch (failure) { if (active.current) setError(failure.message); return undefined; }
            finally { working.current = false; if (active.current) setBusy(false); }
          }
          React.useEffect(() => {
            active.current = true;
            run({ action: 'inspect' }).then(next => {
              if (active.current && next && !next.confirmed && !next.legacy) setOpen(true);
            });
            return () => { active.current = false; };
          }, [sessionId]);
          React.useEffect(() => {
            const node = dialog.current;
            if (!node) return;
            if (open && !node.open) node.showModal();
            if (!open && node.open) node.close();
            return () => { if (node.open) node.close(); };
          }, [open]);
          const locked = !view || view.locked;
          const count = Object.values(selected).filter(Boolean).length;
          const search = query.trim().toLowerCase();
          function choose(name, enabled) {
            dirty.current.add(name);
            const next = { ...currentSelection.current, [name]: enabled };
            currentSelection.current = next; setSelected(next);
          }
          function reset(mode) {
            const next = Object.fromEntries(view.rows.map(row => [row.name, mode === 'common' && row.group === 'common']));
            currentSelection.current = next; dirty.current = new Set(view.rows.map(row => row.name)); setSelected(next);
          }
          const rows = group => (view?.rows ?? []).filter(row => row.group === group && `${row.name} ${row.description}`.toLowerCase().includes(search));
          const rowView = row => h('div', { className: 'sss-row', key: row.name },
            h('label', { className: 'sss-choice' },
              h('input', { type: 'checkbox', checked: selected[row.name] === true, disabled: locked || busy,
                'aria-label': `${t('selection')}: ${row.name}`, onChange: event => choose(row.name, event.target.checked) }),
              h('span', null, h('span', { className: 'sss-name' }, row.name),
                h('span', { className: 'sss-description' }, row.description),
                h('span', { className: 'sss-meta' }, `${row.source} · ${row.provider}`),
                !row.modelInvocable || !row.userInvocable ? h('span', { className: 'sss-meta' },
                  t(row.modelInvocable ? 'modelOnly' : row.userInvocable ? 'userOnly' : 'neither')) : null,
                row.changed ? h('span', { className: 'sss-meta' }, t('changed')) : null)),
            h('select', { value: row.group, disabled: busy, 'aria-label': `${t('group')}: ${row.name}`, title: t('categories'),
              onChange: event => run({ action: 'classify', names: [row.name], group: event.target.value, groupRevision: view.groupRevision }, true) },
              h('option', { value: 'common' }, t('common')), h('option', { value: 'optional' }, t('optional'))));
          return h('div', { className: 'dsh-sss' }, h('style', null, css),
            h('button', { type: 'button', className: 'sss-trigger', 'aria-haspopup': 'dialog', onClick: () => {
              setOpen(true); run({ action: 'inspect' });
            } }, view?.confirmed ? `${t('ready')} (${view.rows.filter(row => row.selected).length})` : t('required')),
            !view?.confirmed ? h('span', { className: 'sss-notice' }, error ? t('unavailable') : t('pending')) : null,
            h('dialog', { ref: dialog, 'aria-label': t('configure'), onCancel: event => { event.preventDefault(); setOpen(false); },
              onClose: () => setOpen(false) },
              h('div', { className: 'sss-heading' }, h('h2', null, t('configure')),
                h('button', { type: 'button', onClick: () => setOpen(false) }, t('close'))),
              h('p', null, t('intro')), h('p', null, t('categories')),
              view?.legacy ? h('p', { role: 'status' }, t('legacy')) : view?.locked ? h('p', { role: 'status' }, t('locked')) : null,
              h('div', { className: 'sss-toolbar' },
                h('input', { type: 'search', className: 'sss-search', placeholder: t('search'), 'aria-label': t('search'),
                  value: query, onChange: event => setQuery(event.target.value) }),
                h('button', { type: 'button', disabled: busy, onClick: () => run({ action: 'inspect' }) }, t('refresh')),
                h('button', { type: 'button', disabled: locked || busy, onClick: () => reset('common') }, t('defaults')),
                h('button', { type: 'button', disabled: locked || busy, onClick: () => reset('none') }, t('none'))),
              error ? h('p', { role: 'alert', className: 'sss-error' }, `${t('error')}: ${error}`) : null,
              busy ? h('p', { role: 'status' }, t('loading')) : null,
              h('div', { className: 'sss-list', 'aria-busy': busy }, ...['common', 'optional'].map(group =>
                h('section', { key: group }, h('h3', null, `${t(group)} (${rows(group).length})`),
                  rows(group).length ? rows(group).map(rowView) : h('p', null, t('empty'))))),
              h('div', { className: 'sss-footer' },
                h('span', { 'aria-live': 'polite' }, notice || `${t('selected')}: ${count} / ${t('all')}: ${view?.rows.length ?? 0}`),
                h('button', { type: 'button', className: 'sss-confirm', disabled: locked || busy, onClick: async () => {
                  const saved = await run({ action: 'confirm', stateRevision: view.stateRevision,
                    groupRevision: view.groupRevision, catalogRevision: view.catalogRevision,
                    selected: view.rows.filter(row => currentSelection.current[row.name]).map(row => row.name) });
                  if (saved && active.current) { setNotice(t('saved')); setOpen(false); }
                } }, t('confirm')))));
        }
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'rocloud1999-session-skill-switch', order: 5, locale: NS,
        }, props => h(Panel, { ...props, key: props.sessionId })));
      },
    };
  },
});
