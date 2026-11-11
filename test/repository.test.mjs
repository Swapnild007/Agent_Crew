import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRepositoryInspector, redact } from '../repository.mjs';

test('sandbox failure never falls back to host Git',async()=>{
  const commands=[];
  const inspector=createRepositoryInspector({runner:async(file,args)=>{
    commands.push([file,args]); throw Error('namespace creation denied');
  }});
  assert.equal(await inspector.status(),false);
  await assert.rejects(inspector.catalog({revision:'0'.repeat(40)}),{code:'sandbox_unavailable'});
  assert.equal(commands.length,1);
  assert.ok(commands[0][1].includes('--unshare-all'));
  assert.ok(commands[0][1].includes('--disable-userns'));
  assert.ok(commands[0][1].includes('--clearenv'));
});

test('secret redaction drops recognizable keys and does not rewrite ordinary evidence',()=>{
  const synthetic='sk-'+'A'.repeat(20);
  assert.equal(redact('example '+synthetic),'example [redacted]');
  assert.equal(redact('Password: '+ 'p'.repeat(14)),'Password: [redacted]');
  assert.equal(redact('The receipt total uses quantities.'),'The receipt total uses quantities.');
});

test('real sandbox denies host writes and network and reads only allowed tracked blobs',async t=>{
  const inspector=createRepositoryInspector();
  if(!await inspector.status()){
    if(process.env.AGENT_CREW_REQUIRE_SANDBOX==='1') assert.fail('Linux namespaces unavailable');
    return t.skip('Linux namespace setup unavailable on this host');
  }
  const root=mkdtempSync(join(tmpdir(),'crew-sandbox-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const tree=join(root,'checkout');
  mkdirSync(tree);
  const git=(...args)=>execFileSync('git',['-C',tree,...args],{stdio:['ignore','pipe','pipe']}).toString().trim();
  git('init','-q');
  writeFileSync(join(tree,'README.md'),'Pinned revision contents.\n');
  writeFileSync(join(tree,'secrets.txt'),'Sensitive fixture.\n');
  writeFileSync(join(tree,'large.txt'),'x'.repeat(8193));
  symlinkSync('/etc/passwd',join(tree,'outside.txt'));
  git('add','.');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Pinned');
  const revision=git('rev-parse','HEAD');
  const repo=await inspector.authorize('sample',join(tree,'.git'),revision);
  writeFileSync(join(tree,'README.md'),'Uncommitted changes.\n');
  assert.deepEqual((await inspector.catalog(repo)).map(item=>item.path),['README.md','large.txt']);
  assert.equal((await inspector.read(repo,'README.md')).text,'Pinned revision contents.\n');
  await assert.rejects(inspector.read(repo,'../../etc/passwd'),{code:'tool_denied'});
  await assert.rejects(inspector.read(repo,'outside.txt'),{code:'tool_denied'});
  await assert.rejects(inspector.read(repo,'secrets.txt'),{code:'tool_denied'});
  await assert.rejects(inspector.read(repo,'large.txt'),{code:'tool_denied'});
  await assert.rejects(inspector.catalog({...repo,inode:'0'}),{code:'repository_changed'});
  assert.deepEqual(await inspector.selfTest(repo),{readOnly:true,hidden:true,network:true,memory:true});
});
