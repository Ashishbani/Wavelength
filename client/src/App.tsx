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
  const [notice, setNotice] = useState('');

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

  // The server evicts a prior session when this account opens the room elsewhere.
  useEffect(() => {
    function onSuperseded() {
      setRoom(null);
      setDeepCode(null);
      try { sessionStorage.removeItem('wl_room'); } catch { /* private mode */ }
      window.history.pushState({}, '', '/');
      setNotice('This room was opened in another tab, so this tab left it.');
    }
    socket.on('session:superseded', onSuperseded);
    return () => { socket.off('session:superseded', onSuperseded); };
  }, []);

  function enterRoom(state: RoomState, id: string) {
    setRoom(state);
    setSelfId(id);
    setDeepCode(null);
    setNotice('');
    try { sessionStorage.setItem('wl_room', state.code); } catch { /* private mode */ }
    window.history.pushState({}, '', `/r/${state.code}`);
  }

  function leaveRoom() {
    socket.emit('room:leave');
    setRoom(null);
    try { sessionStorage.removeItem('wl_room'); } catch { /* private mode */ }
    window.history.pushState({}, '', '/');
  }

  let view;
  if (room) {
    view = <Room initialState={room} selfId={selfId} onLeave={leaveRoom} />;
  } else if (loading) {
    view = <div className="splash">Loading Wavelength…</div>;
  } else if (deepCode) {
    view = (
      <DeepJoin
        code={deepCode}
        onJoined={enterRoom}
        onCancel={() => { setDeepCode(null); window.history.pushState({}, '', '/'); }}
      />
    );
  } else if (user || enteredAsGuest) {
    view = <Lobby onJoined={enterRoom} onBackToAuth={() => setEnteredAsGuest(false)} />;
  } else {
    view = <Auth onGuest={() => setEnteredAsGuest(true)} />;
  }

  return (
    <div className={room ? 'app app-wide' : 'app'}>
      {notice && (
        <div className="notice">
          <span className="grow">{notice}</span>
          <button className="iconbtn" onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      {view}
    </div>
  );
}
