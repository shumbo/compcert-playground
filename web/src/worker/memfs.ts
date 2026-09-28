// A minimal in-memory implementation of the synchronous subset of Node's
// `fs` module that the wasm_of_ocaml runtime uses.  The build patches the
// runtime to pick it up from `globalThis.__wasm_of_ocaml_fs` when it is not
// running under Node.

const constants = {
  R_OK: 4, W_OK: 2, X_OK: 1, F_OK: 0,
  O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2,
  O_CREAT: 0o100, O_EXCL: 0o200, O_NOCTTY: 0o400, O_TRUNC: 0o1000,
  O_APPEND: 0o2000, O_NONBLOCK: 0o4000, O_DSYNC: 0o10000, O_SYNC: 0o4010000,
};

type File = { data: Uint8Array; size: number };
type Fd = { file: File; pos: number; append: boolean };

function fsError(code: string, syscall: string, path?: string) {
  const err = new Error(`${code}: ${syscall}${path ? ` '${path}'` : ''}`) as Error & {
    code: string; syscall: string; path?: string;
  };
  err.code = code;
  err.syscall = syscall;
  if (path) err.path = path;
  return err;
}

function normalize(p: string) {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

export function createMemFs(console_: { out: (s: string) => void; err: (s: string) => void }) {
  const files = new Map<string, File>();
  const fds = new Map<number, Fd>();
  let nextFd = 3;
  const decoder = new TextDecoder();

  const getFd = (fd: number) => {
    const f = fds.get(fd);
    if (!f) throw fsError('EBADF', 'fd');
    return f;
  };

  const ensureCapacity = (file: File, size: number) => {
    if (size <= file.data.length) return;
    const data = new Uint8Array(Math.max(size, file.data.length * 2, 256));
    data.set(file.data.subarray(0, file.size));
    file.data = data;
  };

  const stat = (file: File) => ({
    dev: 0, ino: 0, mode: 0o100644, nlink: 1, uid: 0, gid: 0, rdev: 0,
    size: file.size, atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
    isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
    isCharacterDevice: () => false, isBlockDevice: () => false,
    isFIFO: () => false, isSocket: () => false,
  });

  return {
    constants,

    writeFile(path: string, contents: string) {
      const data = new TextEncoder().encode(contents);
      files.set(normalize(path), { data, size: data.length });
    },
    readFile(path: string): string | undefined {
      const f = files.get(normalize(path));
      return f && decoder.decode(f.data.subarray(0, f.size));
    },

    existsSync: (p: string) => files.has(normalize(p)) || normalize(p) === '/',
    accessSync(p: string) {
      if (!files.has(normalize(p))) throw fsError('ENOENT', 'access', p);
    },
    openSync(p: string, flags: number) {
      const path = normalize(p);
      let file = files.get(path);
      if (file && flags & constants.O_CREAT && flags & constants.O_EXCL)
        throw fsError('EEXIST', 'open', p);
      if (!file) {
        if (!(flags & constants.O_CREAT)) throw fsError('ENOENT', 'open', p);
        file = { data: new Uint8Array(256), size: 0 };
        files.set(path, file);
      }
      if (flags & constants.O_TRUNC) file.size = 0;
      const fd = nextFd++;
      fds.set(fd, { file, pos: 0, append: !!(flags & constants.O_APPEND) });
      return fd;
    },
    closeSync(fd: number) {
      fds.delete(fd);
    },
    writeSync(fd: number, buf: Uint8Array | string, off = 0, len?: number, pos?: number | null) {
      const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : buf;
      const n = len ?? bytes.length - off;
      if (fd === 1 || fd === 2) {
        (fd === 1 ? console_.out : console_.err)(decoder.decode(bytes.subarray(off, off + n)));
        return n;
      }
      const f = getFd(fd);
      let at = pos ?? (f.append ? f.file.size : f.pos);
      ensureCapacity(f.file, at + n);
      f.file.data.set(bytes.subarray(off, off + n), at);
      at += n;
      f.file.size = Math.max(f.file.size, at);
      if (pos == null) f.pos = at;
      return n;
    },
    readSync(fd: number, buf: Uint8Array, off: number, len: number, pos?: number | null) {
      if (fd === 0) return 0;
      const f = getFd(fd);
      const at = pos ?? f.pos;
      const n = Math.max(0, Math.min(len, f.file.size - at));
      buf.set(f.file.data.subarray(at, at + n), off);
      if (pos == null) f.pos = at + n;
      return n;
    },
    fsyncSync() {},
    fstatSync(fd: number, opts?: { bigint?: boolean }) {
      const s = stat(getFd(fd).file);
      return opts?.bigint ? { ...s, size: BigInt(s.size) } : s;
    },
    statSync(p: string, opts?: { throwIfNoEntry?: boolean }) {
      const f = files.get(normalize(p));
      if (!f) {
        if (opts?.throwIfNoEntry === false) return undefined;
        throw fsError('ENOENT', 'stat', p);
      }
      return stat(f);
    },
    lstatSync(p: string) {
      return this.statSync(p);
    },
    unlinkSync(p: string) {
      if (!files.delete(normalize(p))) throw fsError('ENOENT', 'unlink', p);
    },
    renameSync(o: string, n: string) {
      const f = files.get(normalize(o));
      if (!f) throw fsError('ENOENT', 'rename', o);
      files.delete(normalize(o));
      files.set(normalize(n), f);
    },
    mkdirSync() {},
    rmdirSync() {},
    readdirSync: () => [] as string[],
    truncateSync(p: string, len = 0) {
      const f = files.get(normalize(p));
      if (!f) throw fsError('ENOENT', 'truncate', p);
      f.size = Math.min(f.size, len);
    },
    ftruncateSync(fd: number, len = 0) {
      const f = getFd(fd);
      f.file.size = Math.min(f.file.size, len);
    },
  };
}

export type MemFs = ReturnType<typeof createMemFs>;
