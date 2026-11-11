import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { digest } from './runtime.mjs';

const exec = promisify(execFile);
export const identifier = /^[a-z][a-z0-9-]{0,39}$/;
export const revisionPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const sourcePath = /^(?:[A-Za-z0-9_@][A-Za-z0-9_.@+-]*\/)*[A-Za-z0-9_@][A-Za-z0-9_.@+-]*$/;
const readable = /(?:\.(?:md|txt|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|cs|c|h|cpp|sql|html|css|vue|svelte)$|^(?:README|LICENSE))$/i;
const sensitive = /(?:^|[\/_.-])(?:secret[s]?|credential[s]?|token[s]?|password[s]?|key[s]?|env|id_rsa|id_ed25519)(?:[\/_.-]|$)/i;
export const redact = text => text
  .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g,'[redacted]')
  .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[redacted]')
  .replace(/(\b(?:api[_-]?key|password|secret|token)\b["']?\s*[:=]\s*)["']?[^\s"',;}{]{8,}["']?/gi,'$1[redacted]');
const denied = (code,message) => Object.assign(new Error(message),{code});
const pathAllowed = path => path.length <= 200 && sourcePath.test(path) && readable.test(path) && !sensitive.test(path);

function identity(path) {
  const stat = statSync(path,{bigint:true});
  if (!stat.isDirectory()) throw denied('repository_invalid','Git directory is invalid');
  return {device:String(stat.dev),inode:String(stat.ino)};
}

export function createRepositoryInspector({runner=exec}={}) {
  let availability;
  async function isolated(gitDir,args,signal) {
    const mounts = ['--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64'];
    if (gitDir) mounts.push('--ro-bind',gitDir,'/repo');
    try {
      const {stdout} = await runner('/usr/bin/prlimit',[
        '--as=805306368','--cpu=3','--nofile=48','--fsize=0','--core=0','--',
        '/usr/bin/bwrap','--unshare-all','--unshare-user','--disable-userns','--die-with-parent','--new-session','--cap-drop','ALL',
        '--clearenv','--setenv','PATH','/usr/bin','--setenv','HOME','/nonexistent','--setenv','GIT_CONFIG_NOSYSTEM','1',
        '--setenv','GIT_CONFIG_GLOBAL','/dev/null','--setenv','GIT_NO_REPLACE_OBJECTS','1',
        '--setenv','GIT_NO_LAZY_FETCH','1','--setenv','GIT_TERMINAL_PROMPT','0','--setenv','LC_ALL','C',
        ...mounts,'--dev','/dev','--chdir','/','--',...args
      ],{env:{PATH:'/usr/bin'},timeout:5000,maxBuffer:262144,encoding:'buffer',killSignal:'SIGKILL',signal});
      return stdout;
    } catch {
      if (signal?.aborted) throw denied('cancelled','Inspection cancelled');
      throw denied(gitDir?'inspection_failed':'sandbox_unavailable',gitDir?'Isolated Git operation failed or exceeded a limit':'Repository isolation is unavailable');
    }
  }
  async function status() {
    availability ??= isolated(null,['/usr/bin/true']).then(()=>true,()=>false);
    return availability;
  }
  async function git(repo,args,signal) {
    if (!await status()) throw denied('sandbox_unavailable','Repository isolation is unavailable');
    if (!revisionPattern.test(repo.revision)) throw denied('repository_invalid','Invalid pinned revision');
    const current = identity(repo.git_dir);
    if (realpathSync(repo.git_dir)!==repo.git_dir || current.device!==repo.device || current.inode!==repo.inode)
      throw denied('repository_changed','Approved Git directory changed');
    return isolated(repo.git_dir,['/usr/bin/git','--no-pager','--git-dir=/repo','-c','safe.directory=/repo','-c','core.hooksPath=/nonexistent',...args],signal);
  }
  async function authorize(name,path,revision) {
    if (!identifier.test(name) || !revisionPattern.test(revision)) throw denied('repository_invalid','Use a repository name and full commit SHA');
    const git_dir = realpathSync(resolve(path));
    const repo = {name,git_dir,revision,...identity(git_dir)};
    const commit = (await git(repo,['rev-parse','--verify',revision+'^{commit}'])).toString().trim();
    if (commit!==revision) throw denied('repository_invalid','The revision must identify the exact commit');
    return repo;
  }
  async function catalog(repo,signal) {
    const tree = await git(repo,['ls-tree','-rz','--full-tree',repo.revision],signal);
    return tree.toString('utf8').split('\0').flatMap(row=>{
      const match = /^(100644|100755) blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t([^\n]+)$/.exec(row);
      return match && pathAllowed(match[3]) ? [{oid:match[2],path:match[3]}] : [];
    }).slice(0,150);
  }
  async function read(repo,path,signal) {
    if (typeof path!=='string' || !pathAllowed(path)) throw denied('tool_denied','Path is outside the text-file policy');
    const item = (await catalog(repo,signal)).find(entry=>entry.path===path);
    if (!item) throw denied('tool_denied','Path is outside the pinned commit catalog');
    const size = Number((await git(repo,['cat-file','-s',item.oid],signal)).toString().trim());
    if (!Number.isSafeInteger(size) || size<1 || size>8192) throw denied('tool_denied','Text file exceeds the inspection limit');
    const raw = await git(repo,['cat-file','blob',item.oid],signal);
    if (raw.length!==size || raw.includes(0)) throw denied('tool_denied','Binary or invalid blob');
    const objectHash=createHash(item.oid.length===40?'sha1':'sha256').update('blob '+raw.length+'\0').update(raw).digest('hex');
    if(objectHash!==item.oid) throw denied('inspection_failed','Git blob failed identity verification');
    const source = new TextDecoder('utf-8',{fatal:true}).decode(raw);
    return {path,hash:digest(raw),text:redact(source)};
  }
  async function selfTest(repo) {
    if(!await status()) throw denied('sandbox_unavailable','Repository isolation is unavailable');
    const code = [
      'import json, os, resource, socket',
      'read_only = bool(os.statvfs("/repo").f_flag & os.ST_RDONLY)',
      'hidden = not os.path.exists("/etc/passwd") and not os.path.exists("/home")',
      'network = socket.if_nameindex() == [(1, "lo")]',
      'memory = resource.getrlimit(resource.RLIMIT_AS)[0] == 805306368',
      'print(json.dumps(dict(readOnly=read_only, hidden=hidden, network=network, memory=memory)))'
    ].join('\n');
    return JSON.parse(await isolated(repo.git_dir,['/usr/bin/python3','-I','-c',code]));
  }
  return {status,authorize,catalog,read,selfTest};
}
