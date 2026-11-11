import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const aad = Buffer.from('Agent_Crew/OpenAI/v1');
const pathFor = directory => join(directory,'openai.enc');
function key(value) {
  if(!/^[a-f0-9]{64}$/i.test(value||'')) throw new Error('Configure a 32-byte hex AGENT_CREW_SECRET_KEY through your secret manager');
  return Buffer.from(value,'hex');
}
export function storeCredential(directory,masterKey,secret) {
  if(typeof secret!=='string'||secret.length<12||secret.length>1000||/\s/.test(secret)) throw new Error('Invalid OpenAI credential');
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(masterKey),iv);
  cipher.setAAD(aad);
  const body=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  const data=Buffer.concat([iv,cipher.getAuthTag(),body]);
  const destination=pathFor(directory);
  const temp=destination+'.'+randomBytes(10).toString('hex');
  try {
    writeFileSync(temp,data,{mode:0o600,flag:'wx'});
    renameSync(temp,destination);
  } finally { rmSync(temp,{force:true}); }
}
export function readCredential(directory,masterKey) {
  let fd;
  try {
    fd=openSync(pathFor(directory),constants.O_RDONLY|constants.O_NOFOLLOW);
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.mode&0o077||stat.size<40||stat.size>1028) throw Error();
    const data=readFileSync(fd);
    const cipher=createDecipheriv('aes-256-gcm',key(masterKey),data.subarray(0,12));
    cipher.setAAD(aad);
    cipher.setAuthTag(data.subarray(12,28));
    return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8');
  } catch(error) {
    if(error.code==='ENOENT') return undefined;
    throw new Error('Encrypted provider credential could not be opened');
  } finally {
    if(fd!==undefined) closeSync(fd);
  }
}
