import { useState } from 'react';
import type { RoomState } from '@wavelength/shared';
import { useAuth } from './auth/AuthContext.js';
import Auth from './Auth.js';
import Lobby from './Lobby.js';
import Room from './Room.js';

export default function App() {
  const { user, loading } = useAuth();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState<string>('');
  const [enteredAsGuest, setEnteredAsGuest] = useState(false);

  // 1) In a room → the room view.
  if (room) {
    return <div className="app"><Room initialState={room} selfId={selfId} /></div>;
  }

  // 2) Still resolving the session cookie → brief splash (avoids an auth-screen flash).
  if (loading) {
    return <div className="app"><div className="splash">Loading Wavelength…</div></div>;
  }

  // 3) Signed in, or chose guest → the lobby.
  if (user || enteredAsGuest) {
    return (
      <div className="app">
        <Lobby
          onJoined={(s, id) => { setRoom(s); setSelfId(id); }}
          onBackToAuth={() => setEnteredAsGuest(false)}
        />
      </div>
    );
  }

  // 4) Otherwise → the auth entry screen.
  return (
    <div className="app">
      <Auth onGuest={() => setEnteredAsGuest(true)} />
    </div>
  );
}
