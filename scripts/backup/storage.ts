import { copyFile, lstat, mkdir, readdir, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { checkKey } from './archive';
import { runTool } from './safety';

export interface Store {
  kind: 'local' | 's3';
  put(path: string, key: string): Promise<void>;
  get(key: string, path: string): Promise<void>;
  json(key: string): Promise<unknown>;
  list(tier: 'daily' | 'weekly'): Promise<string[]>;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
}
function checkStoreKey(key: string) {
  if (key !== 'latest.json' && key !== 'latest-raw.json') checkKey(key);
}
export async function createStore(env: NodeJS.ProcessEnv = process.env): Promise<Store> {
  if (Boolean(env.BACKUP_LOCAL_DIR) === Boolean(env.BACKUP_S3_BUCKET))
    throw new Error('set exactly one of BACKUP_LOCAL_DIR or BACKUP_S3_BUCKET');
  if (env.BACKUP_LOCAL_DIR) {
    await mkdir(env.BACKUP_LOCAL_DIR, { recursive: true, mode: 0o700 });
    if ((await lstat(env.BACKUP_LOCAL_DIR)).isSymbolicLink())
      throw new Error('local archive root must not be a symbolic link');
    const root = await realpath(env.BACKUP_LOCAL_DIR);
    const pathFor = async (key: string, writing = false) => {
      checkStoreKey(key);
      const path = resolve(root, key);
      const rel = relative(root, path);
      if (rel.startsWith(`..${sep}`) || rel === '..' || !rel)
        throw new Error('object escaped local archive root');
      const parent = dirname(path);
      if (writing) await mkdir(parent, { recursive: true, mode: 0o700 });
      if ((await realpath(parent)) !== parent)
        throw new Error('archive directory must not traverse symbolic links');
      try {
        if ((await lstat(path)).isSymbolicLink())
          throw new Error('archive object must not be a symbolic link');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      return path;
    };
    return {
      kind: 'local',
      put: async (path, key) => {
        await copyFile(path, await pathFor(key, true));
      },
      get: async (key, path) => {
        await copyFile(await pathFor(key), path);
      },
      json: async (key) => {
        const path = await pathFor(key);
        if ((await lstat(path)).size > 64 * 1024 ** 2)
          throw new Error('archive JSON exceeds its 64-MiB budget');
        return JSON.parse(await readFile(path, 'utf8'));
      },
      list: async (tier) => {
        const directory = join(root, tier);
        try {
          if ((await realpath(directory)) !== directory)
            throw new Error('archive directory must not traverse symbolic links');
          return (await readdir(directory)).map((name) => `${tier}/${name}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
          throw error;
        }
      },
      remove: async (key) => {
        checkKey(key);
        try {
          await unlink(await pathFor(key));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      },
      size: async (key) => (await lstat(await pathFor(key))).size,
    };
  }
  const bucket = env.BACKUP_S3_BUCKET ?? '';
  const prefix = env.BACKUP_S3_PREFIX ?? 'civic-ledger';
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)
  ) {
    throw new Error('backup bucket/prefix is invalid');
  }
  const object = (key: string) => {
    checkStoreKey(key);
    return `s3://${bucket}/${prefix}/${key}`;
  };
  const aws = (args: string[]) =>
    runTool('aws', args, { ...env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' });
  return {
    kind: 's3',
    put: async (path, key) => {
      await aws(['s3', 'cp', '--only-show-errors', path, object(key)]);
    },
    get: async (key, path) => {
      await aws(['s3', 'cp', '--only-show-errors', object(key), path]);
    },
    json: async (key) =>
      JSON.parse(await aws(['s3', 'cp', '--only-show-errors', object(key), '-'])),
    list: async (tier) => {
      const result = JSON.parse(
        await aws([
          's3api',
          'list-objects-v2',
          '--bucket',
          bucket,
          '--prefix',
          `${prefix}/${tier}/`,
          '--output',
          'json',
        ]),
      ) as { Contents?: { Key: string }[] };
      return (result.Contents ?? []).map((entry) => entry.Key.slice(prefix.length + 1));
    },
    remove: async (key) => {
      checkKey(key);
      await aws(['s3', 'rm', '--only-show-errors', object(key)]);
    },
    size: async (key) => {
      checkKey(key);
      const result = JSON.parse(
        await aws([
          's3api',
          'head-object',
          '--bucket',
          bucket,
          '--key',
          `${prefix}/${key}`,
          '--output',
          'json',
        ]),
      ) as { ContentLength: number };
      return result.ContentLength;
    },
  };
}
