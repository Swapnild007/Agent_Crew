import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBackup, restoreBackup } from '../backup.mjs';
import { createRuntime } from '../runtime.mjs';

test('encrypted online backup restores mission checkpoints, revokes sessions and invalidates repo scope',t=>{
  const root=mkdtempSync(join(tmpdir(),'crew-backup-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const data=join(root,'data'), restored=join(root,'restored');
  mkdirSync(data);
  const db=new DatabaseSync(join(data,'crew.sqlite'));
  t.after(()=>db.close());
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
  for(const path of ['../schema.sql','../migrations/002.sql','../migrations/003.sql'])
    db.exec(readFileSync(new URL(path,import.meta.url),'utf8'));
  db.prepare('INSERT INTO owner VALUES(1,?,?)').run('fixture',randomBytes(32).toString('hex'));
  db.prepare('INSERT INTO sessions(hash,expires,scope) VALUES(?,?,?)').run('fixture',Date.now()+10000,'local');
  const runtime=createRuntime(db,{now:()=>100,delay:0,repositoryMissions:true});
  const sample=runtime.create('Portable private review');
  runtime.tick();
  db.prepare("INSERT INTO repositories VALUES('approved','/original',?,?,?)").run('a'.repeat(40),'1','2');
  db.prepare("INSERT INTO missions(id,objective,state,created,due,repository,approval) VALUES('repo','Original repo','running',1,1,'approved','approve')").run();
  const output=join(root,'state.crew-backup');
  const passphrase=randomBytes(24).toString('hex');
  createBackup(data,output,passphrase);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
  assert.equal(readFileSync(output).includes('Portable private review'),false);
  assert.throws(()=>createBackup(data,output,passphrase));
  assert.throws(()=>restoreBackup(restored,output,passphrase.slice(1)),/Incorrect passphrase/);
  const damaged=join(root,'damaged.crew-backup');
  const bytes=readFileSync(output);
  bytes[bytes.length-1]^=1;
  writeFileSync(damaged,bytes);
  assert.throws(()=>restoreBackup(restored,damaged,passphrase),/damaged backup/);
  restoreBackup(restored,output,passphrase);
  assert.throws(()=>restoreBackup(restored,output,passphrase),/fresh data directory/);
  const recovered=new DatabaseSync(join(restored,'crew.sqlite'));
  try {
    assert.equal(recovered.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(recovered.prepare('SELECT COUNT(*) AS n FROM repositories').get().n,0);
    const restarted=createRuntime(recovered,{now:()=>100,delay:0,repositoryMissions:true});
    assert.equal(restarted.get('repo').state,'cancelled');
    assert.equal(restarted.get(sample.id).step,1);
    restarted.tick();
    assert.equal(restarted.get(sample.id).step,2);
  } finally { recovered.close(); }
});
