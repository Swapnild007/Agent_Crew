export function remotePolicy(env,port) {
  const local='http://127.0.0.1:'+port;
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
