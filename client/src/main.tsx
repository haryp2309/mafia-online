import { createRoot } from 'react-dom/client';
import { normaliseRoomCode } from '../../shared/protocol';
import { BotsApp } from './BotsApp';
import { HostApp } from './host/HostApp';
import { Landing } from './Landing';
import { PlayerApp } from './player/PlayerApp';
import { currentScreen } from './routes';
import './styles.css';

const room = normaliseRoomCode(new URLSearchParams(window.location.search).get('room') ?? '');
const screen = currentScreen(room);

function App() {
  if (screen === 'host') return <HostApp />;
  if (screen === 'bots') return <BotsApp />;
  if (screen === 'player') return <PlayerApp room={room} />;
  return <Landing />;
}

createRoot(document.getElementById('root')!).render(<App />);
