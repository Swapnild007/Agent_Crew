export function remotePolicy(env,port) {
  const local='http://127.0.0.1:'+port;
  if(env.CODESPACES==='true'){
    const name=env.CODESPACE_NAME;
    if(port!==4317||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name||'')||
      env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN!=='app.github.dev'||
      env.AGENT_CREW_PUBLIC_ORIGIN||env.AGENT_CREW_TAILSCALE_OWNER)
      throw new Error('Codespaces requires its assigned private HTTPS origin and port 4317');
    const host=name+'-'+port+'.app.github.dev';
    const origin='https://'+host;
    return {
      origin,scope:origin,cookie:'__Host-crew_session',secure:true,kind:'codespaces',
      permit(req) {
        const headers=req.headers;
        const forwardedHost=headers['x-forwarded-host'];
        const forwardedProtocol=headers['x-forwarded-proto'];
        const external=headers.host===host&&(!forwardedHost||forwardedHost===host);
        const rewritten=[new URL(local).host,'localhost:'+port].includes(headers.host)&&
          forwardedHost===host&&forwardedProtocol==='https';
        return req.socket.remoteAddress==='127.0.0.1' &&
          (!forwardedProtocol||forwardedProtocol==='https') && (external||rewritten);
      }
    };
  }
  const configured=env.AGENT_CREW_PUBLIC_ORIGIN;
  const owner=env.AGENT_CREW_TAILSCALE_OWNER;
  if(!configured&&!owner) return {
    origin:local,scope:'local',cookie:'crew_session',secure:false,
    permit:req=>req.headers.host===new URL(local).host
  };
  let origin;
  try { origin=new URL(configured); } catch { throw new Error('Invalid remote HTTPS origin'); }
  if(origin.origin!==configured||origin.protocol!=='https:'||!origin.hostname.endsWith('.ts.net')||
    !owner||!/^[a-z0-9][a-z0-9._%+@-]{0,253}$/i.test(owner))
    throw new Error('Remote access requires an exact HTTPS tailnet origin and owner login');
  return {
    origin:origin.origin,scope:origin.origin+'|'+owner,cookie:'__Host-crew_session',secure:true,
    permit(req) {
      // Serve may preserve the external host or use the configured localhost upstream host.
      const host=req.headers.host;
      return req.socket.remoteAddress==='127.0.0.1' &&
        (host===origin.host||host===new URL(local).host) &&
        req.headers['x-forwarded-host']===origin.host &&
        req.headers['tailscale-funnel-request']===undefined &&
        req.headers['tailscale-user-login']===owner &&
        req.headers['x-forwarded-proto']==='https';
    }
  };
}
