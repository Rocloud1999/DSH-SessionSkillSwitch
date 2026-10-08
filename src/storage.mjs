/** Profile-local JSON storage. Writes are serialized across processes, fsynced, then renamed. */
import { mkdir, readFile, open, rename, unlink, lstat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fail, resolveGroups, restoreSelection } from './policy.mjs';

export function defaultStateDir(env = process.env) {
  return join(env.DSH_PROFILE_DIR || env.DSH_HOME || join(homedir(), '.dsh'), 'plugin-data', 'session-skill-switch');
}
function validateDocument(value, kind) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1) fail('CORRUPT_STATE', 'Unsupported or corrupt plugin state; restore a backup before continuing.');
  if (kind === 'groups' && (!value.groups || typeof value.groups !== 'object' || Array.isArray(value.groups))) fail('CORRUPT_STATE', 'Invalid stored groups.');
  if (kind === 'groups') return { version: 1, revision: value.revision, groups: resolveGroups({ groups: value.groups }).groups };
  if (typeof value.locked !== 'boolean') fail('CORRUPT_STATE', 'Invalid session lock.');
  return { version: 1, revision: value.revision, locked: value.locked, selection: restoreSelection(value.selection) };
}
export class JsonStore {
  constructor(directory = defaultStateDir()) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) fail('INVALID_CONFIG', 'stateDir must be an absolute path.');
    this.directory = resolve(directory);
  }
  path(kind, id = '') {
    if (kind === 'groups') return join(this.directory, 'groups.json');
    if (kind !== 'session' || typeof id !== 'string' || !id) fail('INVALID_SCOPE', 'Session identity is required.');
    const key = createHash('sha256').update(id).digest('hex');
    return join(this.directory, `session-${key}.json`);
  }
  async read(kind, id) {
    const file = this.path(kind, id);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) fail('CORRUPT_STATE', 'State must be a regular JSON file smaller than 4 MiB.');
      return validateDocument(JSON.parse(await readFile(file, 'utf8')), kind);
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      if (error instanceof SyntaxError) fail('CORRUPT_STATE', 'Plugin state is not valid JSON; it will not be reset automatically.');
      throw error;
    }
  }
  async update(kind, id, expectedRevision, change, signal) {
    signal?.throwIfAborted();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(this.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail('UNSAFE_STATE_DIR', 'State directory must be a real directory, not a symlink.');
    const file = this.path(kind, id), lock = `${file}.lock`;
    let lockHandle;
    try { lockHandle = await open(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') fail('STATE_BUSY', 'Another writer holds the state lock. Retry; after a crash, see README recovery instructions.'); throw error; }
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await lockHandle.writeFile(JSON.stringify({ pid: process.pid, time: new Date().toISOString() }));
      const current = await this.read(kind, id);
      if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) fail('STALE_STATE', 'Configuration changed in another window. Refresh and retry.');
      signal?.throwIfAborted();
      const value = validateDocument({ ...await change(current), version: 1, revision: (current?.revision ?? 0) + 1 }, kind);
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      signal?.throwIfAborted();
      await rename(temp, file);
      // Windows and some virtual filesystems do not support directory fsync.
      try { const dir = await open(this.directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
      catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES', 'EBADF'].includes(error.code)) throw error; }
      return value;
    } finally {
      await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await lockHandle.close();
      await unlink(lock);
    }
  }
}
