import { remotePolicy } from '../remote.mjs';
import { createRepositoryInspector } from '../repository.mjs';

const policy=remotePolicy(process.env,Number(process.env.PORT||4317));
if(!policy.secure||policy.origin==='https://agent-crew.example.ts.net'||
  process.env.AGENT_CREW_TAILSCALE_OWNER==='owner@example.invalid')
  throw new Error('Provision the real tailnet origin and owner before starting the remote service');
if(process.env.AGENT_CREW_ALLOW_PAID==='1'||process.env.AGENT_CREW_PROVIDER==='openai')
  throw new Error('Paid providers are disabled in the zero-cost service');
if(!await createRepositoryInspector().status())
  throw new Error('Repository sandbox unavailable under the service identity');
