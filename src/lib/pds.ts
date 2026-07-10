const pdsCache = new Map<string, string>();

export async function resolvePds(did: string): Promise<string> {
  const cached = pdsCache.get(did);
  if (cached) return cached;

  if (did.startsWith('did:plc:')) {
    const plcRes = await fetch(`https://plc.directory/${did}`);
    if (plcRes.ok) {
      const plcDoc = await plcRes.json();
      const pdsService = plcDoc.service?.find((s: any) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
      if (pdsService && pdsService.serviceEndpoint) {
        const endpoint = pdsService.serviceEndpoint;
        pdsCache.set(did, endpoint);
        return endpoint;
      }
    } else if (plcRes.status === 429) {
      throw new Error('Rate limited by plc.directory');
    }
  } else if (did.startsWith('did:web:')) {
    const domain = did.slice(8);
    const webRes = await fetch(`https://${domain}/.well-known/did.json`);
    if (webRes.ok) {
      const webDoc = await webRes.json();
      const pdsService = webDoc.service?.find((s: any) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
      if (pdsService && pdsService.serviceEndpoint) {
        const endpoint = pdsService.serviceEndpoint;
        pdsCache.set(did, endpoint);
        return endpoint;
      }
    }
  }
  
  throw new Error(`Failed to resolve PDS for DID: ${did}`);
}

