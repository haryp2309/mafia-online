import { useState } from 'react';
import { normaliseRoomCode } from '../../shared/protocol';
import { routes } from './routes';

/** Front door: join a room with its code, or start hosting a game on this device. */
export function Landing() {
  const [code, setCode] = useState('');
  const ready = code.length === 5;

  return (
    <div className="app landing">
      <div className="landing-hero">
        <div className="cast" aria-hidden>
          <span>🕶️</span>
          <span>🕵️</span>
          <span>🩺</span>
          <span>🌾</span>
          <span>💣</span>
        </div>
        <h1 className="logo">MAFIA</h1>
        <p className="tagline">Lies, alibis and late-night murders. Bring your friends and your best poker face.</p>
      </div>

      <form
        className="panel join-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) window.location.href = routes.join(code);
        }}
      >
        <label className="kicker" htmlFor="room">
          🎟️ Got a room code?
        </label>
        <input
          id="room"
          className="code-input"
          value={code}
          onChange={(e) => setCode(normaliseRoomCode(e.target.value))}
          placeholder="ABCDE"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
        />
        <button className="btn big" disabled={!ready}>
          Join the game
        </button>
      </form>

      <div className="or">or</div>

      <a className="btn big red host-link" href={routes.host}>
        📺 Host a new game
      </a>
      <p className="small center-text fine-print">
        The host screen (a laptop or TV everyone can see) runs the whole game. Keep it open while you play.
      </p>
    </div>
  );
}
