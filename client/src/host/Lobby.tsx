import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { PublicState } from '../../../shared/types';
import { absolute, routes } from '../routes';
import { Avatar } from '../ui';
import { send } from '../useGame';

export function Lobby({ pub, roomCode }: { pub: PublicState; roomCode: string }) {
  const url = absolute(routes.join(roomCode));
  const [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#17121f', light: '#fbf3e4' } }).then(setQr);
  }, [url]);

  const waiting = pub.players.filter((p) => !p.claimed);

  return (
    <div className="lobby">
      <section className="panel wanted">
        <div className="wanted-title">JOIN THE FAMILY</div>
        {qr && <img className="qr" src={qr} alt={`QR code for ${url}`} />}
        <div className="kicker">or go to {absolute(routes.home).replace(/^https?:\/\//, '').replace(/\/$/, '')} and enter</div>
        <div className="room-code">{roomCode}</div>
        <p className="small">Scan with your phone camera, then tap your own name.</p>
      </section>

      <section className="panel">
        <div className="kicker">
          🎟️ {pub.players.length - waiting.length} of {pub.players.length} have joined
        </div>
        <ul className="player-list join-list">
          {pub.players.map((p) => (
            <li key={p.id} className={p.claimed ? 'joined' : ''}>
              <Avatar name={p.name} size="sm" />
              <span className="grow">{p.name}</span>
              {p.claimed ? (
                <>
                  <span className={`conn ${p.connected ? 'on' : 'off'}`} />
                  <button className="btn small ghost" onClick={() => send('host:releaseClaim', p.id)}>
                    Release
                  </button>
                </>
              ) : (
                <span className="small waiting-dots">waiting</span>
              )}
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="btn ghost" onClick={() => send('host:backToSetup')}>
            ← Back to setup
          </button>
          <button className="btn big grow" disabled={waiting.length > 0} onClick={() => send('host:start')}>
            {waiting.length ? `Waiting for ${waiting.length}…` : '🃏 Deal the roles!'}
          </button>
        </div>
      </section>
    </div>
  );
}
