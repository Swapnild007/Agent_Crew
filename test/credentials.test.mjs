import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { readCredential, storeCredential } from '../credentials.mjs';

test('encrypted credential persists ciphertext, rejects tampering and supports rotation',t=>{
  const directory=mkdtempSync(join(tmpdir(),'crew-credential-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const key=randomBytes(32).toString('hex');
  const secret=randomBytes(24).toString('hex');
  const path=join(directory,'openai.enc');
  assert.equal(readCredential(directory,key),undefined);
  storeCredential(directory,key,secret);
  assert.equal(statSync(path).mode&0o777,0o600);
  assert.equal(readCredential(directory,key),secret);
  const data=readFileSync(path);
  assert.equal(data.includes(secret),false);
  assert.throws(()=>readCredential(directory,randomBytes(32).toString('hex')),/could not be opened/);
  data[35]^=1;
  writeFileSync(path,data);
  assert.throws(()=>readCredential(directory,key),/could not be opened/);
  storeCredential(directory,key,secret+'-rotated');
  assert.equal(readCredential(directory,key),secret+'-rotated');
});
