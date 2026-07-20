import { useEffect, useState } from 'react';
import type { RoomState } from '@wavelength/shared';
import socket from './socket.js';
import { useAuth } from './auth/AuthContext.js';
import Auth from './Auth.js';
import Lobby from './Lobby.js';
import Room from './Room.js';
import DeepJoin from './DeepJoin.js';

function codeFromPath(): string | null {
  const m = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{1,12})$/);
  return m ? m[1].toUpperCase() : null;
}

export default function App() {
  const { user, loading } = useAuth();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState<string>('');
  const [enteredAsGuest, setEnteredAsGuest] = useState(false);
  const [deepCode, setDeepCode] = useState<string | null>(codeFromPath());

  // Keep view in sync with browser Back/Forward.
  useEffect(() => {
    function onPop() {
      const c = codeFromPath();
      setDeepCode(c);
      if (!c && room) { socket.emit('room:leave'); setRoom(null); }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [room]);

  function enterRoom(state: RoomState, id: string) {
    setRoom(state);
    setSelfId(id);
    setDeepCode(null);
    try { sessionStorage.setItem('wl_room', state.code); } catch { /* private mode */ }
    window.history.pushState({}, '', `/r/${state.code}`);
  }

  function leaveRoom() {
    socket.emit('room:leave');
    setRoom(null);
    try { sessionStorage.removeItem('wl_room'); } catch { /* private mode */ }
    window.history.pushState({}, '', '/');
  }

  if (room) {
    return <div className="app app-wide"><Room initialState={room} selfId={selfId} onLeave={leaveRoom} /></div>;
  }
  if (loading) {
    return <div className="app"><div className="splash">Loading Wavelength…</div></div>;
  }
  if (deepCode) {
    return (
      <div className="app">
        <DeepJoin
          code={deepCode}
          onJoined={enterRoom}
          onCancel={() => { setDeepCode(null); window.history.pushState({}, '', '/'); }}
        />
      </div>
    );
  }
  if (user || enteredAsGuest) {
    return (
      <div className="app">
        <Lobby onJoined={enterRoom} onBackToAuth={() => setEnteredAsGuest(false)} />
      </div>
    );
  }
  return (
    <div className="app">
      <Auth onGuest={() => setEnteredAsGuest(true)} />
    </div>
  );
}
