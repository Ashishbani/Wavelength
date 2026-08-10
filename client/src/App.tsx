import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '@wavelength/shared';
import socket from './socket.js';
import { useAuth } from './auth/AuthContext.js';
import Auth from './Auth.js';
import Lobby from './Lobby.js';
import Room from './Room.js';
import DeepJoin from './DeepJoin.js';
import { exitApp, isNativeApp, onNativeBack } from './lib/native.js';
import { scrollToTop } from './lib/scroll.js';

function codeFromPath(): string | null {
  const m = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{1,12})$/);
  return m ? m[1].toUpperCase() : null;
}

export default function App() {
  const { user, loading, logout } = useAuth();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState<string>('');
  const [enteredAsGuest, setEnteredAsGuest] = useState(false);
  const [deepCode, setDeepCode] = useState<string | null>(codeFromPath());
  const [notice, setNotice] = useState('');
  const [askExit, setAskExit] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [askLogout, setAskLogout] = useState(false);
  // Set when the sign-in screen is opened deliberately (the lobby's Log in
  // button), so it opens at the form instead of the marketing hero.
  const [focusAuthForm, setFocusAuthForm] = useState(false);

  // Which screen is showing — drives both rendering and Back behaviour.
  const view: 'room' | 'loading' | 'deepJoin' | 'lobby' | 'auth' =
    room ? 'room' : loading ? 'loading' : deepCode ? 'deepJoin' : (user || enteredAsGuest) ? 'lobby' : 'auth';

  // Every screen change starts at the top — otherwise the previous screen's
  // scroll position carries over and the new one opens part-way down.
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    scrollToTop();
  }, [view]);

  // Back navigation: keep a sentinel history entry so the hardware/browser Back
  // always fires popstate (instead of closing the app's WebView), then move one
  // screen back ourselves. At the first screen we ask before exiting.
  // The URL the current screen should show. Re-arming pushes a fresh entry, and
  // without this it would inherit whatever URL the popped entry had — a Back
  // press inside a room used to rewrite the address bar from /r/CODE to /, so a
  // refresh afterwards dropped the user out of the room.
  const pathRef = useRef('/');
  pathRef.current = room ? `/r/${room.code}` : deepCode ? `/r/${deepCode}` : '/';

  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    // An open dialog absorbs Back (dismiss it) instead of stacking prompts.
    if (askExit || askLeave || askLogout) { setAskExit(false); setAskLeave(false); setAskLogout(false); return true; }
    // Leaving a room is disruptive for everyone in it, so confirm first.
    if (room) { setAskLeave(true); return true; }
    if (deepCode) { setDeepCode(null); return true; }    // invite screen → lobby/auth
    // Signed in at the lobby, there's no earlier app screen to reach. In the app
    // that means Back would close Wavelength, so it confirms ending the session.
    // On the web it means the browser's Back — which should do what it says and
    // return to the page the user came from. The session cookie survives, so
    // they come back signed in; nothing is lost by leaving.
    if (user) { if (!isNativeApp()) return false; setAskLogout(true); return true; }
    if (enteredAsGuest) { setEnteredAsGuest(false); return true; } // guest lobby → sign in
    return false;                                        // at the sign-in screen
  };

  useEffect(() => {
    const armed = () => (window.history.state as { wlBack?: boolean } | null)?.wlBack === true;
    const arm = () => window.history.pushState({ wlBack: true }, '', pathRef.current);
    if (!armed()) arm();
    function onPop() {
      if (backRef.current()) {
        arm(); // re-arm so the next Back press is ours too
        return;
      }
      // Nothing left to go back through. Closing is a real action in the app, so
      // it asks first. A browser tab can't be closed by script anyway, and Back
      // there means "the page I came from" — so step out of the site instead of
      // trapping the user behind a prompt that can't do anything.
      if (isNativeApp()) { setAskExit(true); arm(); return; }
      window.history.back();
      // Opened straight into a fresh tab, there may be nowhere to go; if we're
      // still here, re-arm so in-app Back (leaving a room) keeps working.
      window.setTimeout(() => { if (!armed()) arm(); }, 150);
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
    // In the native app the hardware Back button is delivered here instead —
    // no dependence on the WebView's history stack, which is what broke after
    // relaunching the app.
    const offNative = onNativeBack(() => {
      if (!backRef.current()) setAskExit(true);
    });
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('visibilitychange', reArm);
      window.removeEventListener('pageshow', reArm);
      window.removeEventListener('focus', reArm);
      offNative();
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
    // The header's Leave button confirms too — same dialog the Back button uses.
    screen = <Room initialState={room} selfId={selfId} onLeave={() => setAskLeave(true)} />;
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
    screen = (
      <Lobby
        onJoined={enterRoom}
        onBackToAuth={() => { setFocusAuthForm(true); setEnteredAsGuest(false); }}
        onRequestLogout={() => setAskLogout(true)}
      />
    );
  } else {
    screen = <Auth onGuest={() => setEnteredAsGuest(true)} focusForm={focusAuthForm} />;
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
            <p className="muted">The room stays open for everyone else.</p>
            <div className="modal-actions">
              <button className="ghost sm-btn" onClick={() => setAskLeave(false)}>Stay</button>
              <button className="primary sm-btn" onClick={() => { setAskLeave(false); leaveRoom(); }}>Leave</button>
            </div>
          </div>
        </div>
      )}

      {askLogout && (
        <div className="modal-backdrop" onClick={() => setAskLogout(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h3>Log out?</h3>
            <p className="muted">You'll need to sign in again.</p>
            <div className="modal-actions">
              <button className="ghost sm-btn" onClick={() => setAskLogout(false)}>Stay</button>
              <button className="primary sm-btn" onClick={() => {
                setAskLogout(false);
                setEnteredAsGuest(false);
                void logout();
              }}>Log out</button>
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
              <button className="ghost sm-btn" onClick={() => setAskExit(false)}>Stay</button>
              <button className="primary sm-btn" onClick={() => { setAskExit(false); exitApp(); }}>
                {isNativeApp() ? 'Exit' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
