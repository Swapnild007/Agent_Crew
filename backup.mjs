import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const signature=Buffer.from('AGENT-CREW-BACKUP-1\n');
const maximum=64*1024*1024;
const options={N:32768,r:8,p:1,maxmem:64*1024*1024};

function requirePassword(value) {
  if(typeof value!=='string'||value.length<20||value.length>256)
    throw new Error('Use a backup passphrase of 20–256 characters');
}
function bounded(path,limit) {
  if(statSync(path).size>limit) throw new Error('Backup exceeds the supported size limit');
  return readFileSync(path);
}
function scrub(file,restore) {
  const database=new DatabaseSync(file,{enableDoubleQuotedStringLiterals:false});
  try {
    database.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON');
    const version=database.prepare('PRAGMA user_version').get().user_version;
    if(![1,2,3].includes(version)||database.prepare('PRAGMA quick_check').get().quick_check!=='ok'||
      database.prepare('SELECT COUNT(*) AS n FROM owner WHERE id=1').get().n!==1)
      throw new Error('Backup is not a supported Agent_Crew database');
    database.exec('BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM auth_limit;');
    if(version>=2) {
      database.exec('DELETE FROM reauth_limit;');
      if(restore){
        const affected=database.prepare("SELECT id FROM missions WHERE repository IS NOT NULL AND state IN ('queued','running','awaiting_approval')").all();
        const audit=database.prepare("INSERT INTO events(mission,kind,detail,created) VALUES(?,'restore_cancelled',?,?)");
        for(const {id} of affected) audit.run(id,'Repository authorization must be renewed after restore',Date.now());
        database.exec(`UPDATE missions SET state='cancelled',approval='cancelled',lease=NULL,lease_until=0
          WHERE repository IS NOT NULL AND state IN ('queued','running','awaiting_approval');
          DELETE FROM repositories;`);
      }
    }
    database.exec('COMMIT; VACUUM;');
  } finally { database.close(); }
}

export function createBackup(directory,output,passphrase) {
  requirePassword(passphrase);
  const path=join(directory,'crew.sqlite');
  if(!existsSync(path)) throw new Error('No Agent_Crew database exists');
  if(!output.endsWith('.crew-backup')) throw new Error('Use a .crew-backup filename');
  const temporary=mkdtempSync(join(tmpdir(),'crew-export-'));
  try {
    const snapshot=join(temporary,'snapshot.sqlite');
    const db=new DatabaseSync(path,{readOnly:true});
    try {
      const {page_count}=db.prepare('PRAGMA page_count').get();
      const {page_size}=db.prepare('PRAGMA page_size').get();
      if(page_count*page_size>maximum) throw new Error('Database exceeds the supported backup size');
      db.exec('PRAGMA busy_timeout=5000');
      db.prepare('VACUUM INTO ?').run(snapshot);
    } finally { db.close(); }
    scrub(snapshot,false);
    const salt=randomBytes(16);
    const iv=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',scryptSync(passphrase,salt,32,options),iv);
    cipher.setAAD(signature);
    const bytes=Buffer.concat([cipher.update(bounded(snapshot,maximum)),cipher.final()]);
    writeFileSync(output,Buffer.concat([signature,salt,iv,cipher.getAuthTag(),bytes]),{flag:'wx',mode:0o600});
  } finally { rmSync(temporary,{recursive:true,force:true}); }
}

export function restoreBackup(directory,input,passphrase) {
  requirePassword(passphrase);
  const target=join(directory,'crew.sqlite');
  if(['','-wal','-shm','-journal'].some(suffix=>existsSync(target+suffix)))
    throw new Error('Restore requires a fresh data directory');
  const bytes=bounded(input,maximum+signature.length+44);
  if(bytes.length<=signature.length+44||!bytes.subarray(0,signature.length).equals(signature))
    throw new Error('Invalid Agent_Crew backup');
  const start=signature.length;
  let plaintext;
  try {
    const decipher=createDecipheriv('aes-256-gcm',scryptSync(passphrase,bytes.subarray(start,start+16),32,options),bytes.subarray(start+16,start+28));
    decipher.setAAD(signature);
    decipher.setAuthTag(bytes.subarray(start+28,start+44));
    plaintext=Buffer.concat([decipher.update(bytes.subarray(start+44)),decipher.final()]);
  } catch { throw new Error('Incorrect passphrase or damaged backup'); }
  mkdirSync(dirname(target),{recursive:true,mode:0o700});
  const temporary=mkdtempSync(join(directory,'.restore-'));
  try {
    const snapshot=join(temporary,'snapshot.sqlite');
    writeFileSync(snapshot,plaintext,{mode:0o600,flag:'wx'});
    scrub(snapshot,true);
    linkSync(snapshot,target);
  } finally {
    plaintext.fill(0);
    rmSync(temporary,{recursive:true,force:true});
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  process.umask(0o077);
  try {
    const [action,path]=process.argv.slice(2);
    if(!path||!['create','restore'].includes(action)) throw new Error('Usage: node backup.mjs create|restore FILE.crew-backup');
    const directory=resolve(process.env.AGENT_CREW_DATA||process.env.STATE_DIRECTORY||'data');
    const passphrase=readFileSync(0,'utf8').replace(/\r?\n$/,'');
    if(action==='create') createBackup(directory,path,passphrase);
    else restoreBackup(directory,path,passphrase);
    console.log(action==='create'?'Encrypted backup saved.':'Restored. Sign in again and renew repository permissions.');
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
