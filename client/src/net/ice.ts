/**
 * How browsers find a path to each other. STUN servers help most devices connect directly;
 * a relay (TURN) is only used when a direct path is impossible. Relay servers can be added at
 * build time as JSON in VITE_ICE_SERVERS (e.g. a GitHub repository variable), since a static
 * site has nowhere to keep a secret. Without one, phones connect directly only.
 */
const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

function configuredRelays(): RTCIceServer[] {
  try {
    const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined;
    const parsed = raw ? (JSON.parse(raw) as RTCIceServer[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function iceServers(): Promise<RTCIceServer[]> {
  return Promise.resolve([...STUN, ...configuredRelays()]);
}

/** True when this connection goes through a relay server instead of directly between devices. */
export async function usesRelay(pc: RTCPeerConnection | undefined): Promise<boolean> {
  if (!pc) return false;
  try {
    const stats = await pc.getStats();
    let pairId: string | undefined;
    stats.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
    });
    let pair: { localCandidateId: string; remoteCandidateId: string } | undefined;
    stats.forEach((r) => {
      const selected = pairId ? r.id === pairId : r.nominated && r.state === 'succeeded';
      if (r.type === 'candidate-pair' && selected) pair = r;
    });
    if (!pair) return false;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    return local?.candidateType === 'relay' || remote?.candidateType === 'relay';
  } catch {
    return false;
  }
}
