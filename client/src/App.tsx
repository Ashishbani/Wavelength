import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '@wavelength/shared';
import socket from './socket.js';
import { useAuth } from './auth/AuthContext.js';
import Auth from './Auth.js';
import Lobby from './Lobby.js';
import Room from './Room.js';
import DeepJoin from './DeepJoin.js';
import { exitApp, isNativeApp } from './lib/native.js';

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
  const [askExit, setAskExit] = useState(false);
  const [askLeave, setAskLeave] = useState(false);

  // Which screen is showing — drives both rendering and Back behaviour.
  const view: 'room' | 'loading' | 'deepJoin' | 'lobby' | 'auth' =
    room ? 'room' : loading ? 'loading' : deepCode ? 'deepJoin' : (user || enteredAsGuest) ? 'lobby' : 'auth';

  // Every screen change starts at the top — otherwise the previous screen's
  // scroll position carries over and the new one opens part-way down.
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, [view]);

  // Back navigation: keep a sentinel history entry so the hardware/browser Back
  // always fires popstate (instead of closing the app's WebView), then move one
  // screen back ourselves. At the first screen we ask before exiting.
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    // Leaving a room is disruptive for everyone in it, so confirm first.
    if (room) { setAskLeave(true); return true; }
    if (deepCode) { setDeepCode(null); return true; }    // invite screen → lobby/auth
    if (enteredAsGuest && !user) { setEnteredAsGuest(false); return true; } // lobby → sign in
    return false;                                        // at home
  };

  useEffect(() => {
    const armed = () => (window.history.state as { wlBack?: boolean } | null)?.wlBack === true;
    const arm = () => window.history.pushState({ wlBack: true }, '');
    if (!armed()) arm();
    function onPop() {
      const handled = backRef.current();
      if (!handled) setAskExit(true);
      arm(); // re-arm so the next Back press is ours too
    }
    // Coming back from the background (or a restored WebView) can leave us
    // without the sentinel — without this, the next Back closes the app and the
    // exit prompt never appears again.
    function reArm() {
      if (document.visibilityState === 'visible' && !armed()) arm();
    }
    window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', reArm);
    window.addEventListener('pageshow', reArm);
    window.addEventListener('focus', reArm);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('visibilitychange', reArm);
      window.removeEventListener('pageshow', reArm);
      window.removeEventListener('focus', reArm);
    };
  }, []);

  // The server evicts a prior session when this account opens the room elsewhere.
  useEffect(() => {
    function onSuperseded() {
      setRoom(null);
      setDeepCode(null);
      try { sessionStorage.removeItem('wl_room'); } catch { /* private mode */ }
      window.history.replaceState({ wlBack: true }, '', '/');
      setNotice('This room was opened in another tab, so this tab left it.');
    }
    socket.on('session:superseded', onSuperseded);
    return () => { socket.off('session:superseded', onSuperseded); };
  }, []);

  // The URL mirrors the current room so links stay shareable; history entries
  // are managed by the Back handler above, so these only replace.
  function enterRoom(state: RoomState, id: string) {
    setRoom(state);
    setSelfId(id);
    setDeepCode(null);
    setNotice('');
    try { sessionStorage.setItem('wl_room', state.code); } catch { /* private mode */ }
    window.history.replaceState({ wlBack: true }, '', `/r/${state.code}`);
  }

  function leaveRoom() {
    socket.emit('room:leave');
    setRoom(null);
    try { sessionStorage.removeItem('wl_room'); } catch { /* private mode */ }
    window.history.replaceState({ wlBack: true }, '', '/');
  }

  let screen;
  if (view === 'room' && room) {
    screen = <Room initialState={room} selfId={selfId} onLeave={leaveRoom} />;
  } else if (view === 'loading') {
    screen = <div className="splash">Loading Wavelength…</div>;
  } else if (view === 'deepJoin' && deepCode) {
    screen = (
      <DeepJoin
        code={deepCode}
        onJoined={enterRoom}
        onCancel={() => { setDeepCode(null); window.history.replaceState({ wlBack: true }, '', '/'); }}
      />
    );
  } else if (view === 'lobby') {
    screen = <Lobby onJoined={enterRoom} onBackToAuth={() => setEnteredAsGuest(false)} />;
  } else {
    screen = <Auth onGuest={() => setEnteredAsGuest(true)} />;
  }

  return (
    <div className={room ? 'app app-wide' : 'app'}>
      {notice && (
        <div className="notice">
          <span className="grow">{notice}</span>
          <button className="iconbtn" onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      {screen}

      {askLeave && (
        <div className="modal-backdrop" onClick={() => setAskLeave(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h3>Leave this room?</h3>
            <p className="muted">You'll stop listening together. The room stays open for everyone else.</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setAskLeave(false)}>Keep listening</button>
              <button className="primary" onClick={() => { setAskLeave(false); leaveRoom(); }}>Leave</button>
            </div>
          </div>
        </div>
      )}

      {askExit && (
        <div className="modal-backdrop" onClick={() => setAskExit(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h3>Leave Wavelength?</h3>
            <p className="muted">{isNativeApp() ? 'Close the app?' : 'You can come back any time.'}</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setAskExit(false)}>Stay</button>
              <button className="primary" onClick={() => { setAskExit(false); exitApp(); }}>
                {isNativeApp() ? 'Exit' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
