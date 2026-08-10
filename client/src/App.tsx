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

/** Is our Back-intercepting history entry the one currently on top? */
function isArmed(): boolean {
  return (window.history.state as { wlBack?: boolean } | null)?.wlBack === true;
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
  // 'stay' ends the session and shows the sign-in screen (the Log out button,
  // and Back in the app). 'leave' also returns to the page the user came from,
  // which is what Back means in a browser.
  const [askLogout, setAskLogout] = useState<false | 'stay' | 'leave'>(false);
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

  // Is there a page behind us to return to? Read once, before we push anything
  // of our own. A tab opened straight onto Wavelength (bookmark, typed URL, new
  // tab) has nothing behind it, and its Back button is rightly greyed out —
  // arming there would resurrect a dead button that then swallowed the press.
  // history.length counts the current entry, so >1 means something sits behind
  // us. (The Navigation API's canGoBack looks like the better answer but isn't:
  // it only sees same-origin entries, so arriving from a search engine — the
  // whole case this exists for — reports false.)
  const [canLeaveSite] = useState(() => window.history.length > 1);

  // Back navigation. A sentinel history entry is what turns a Back press into a
  // popstate we can act on, so we keep one whenever Back has something to do:
  // an app screen sits behind the current one, or there's a page to return to
  // and we want to confirm before going. The native shell always keeps one — a
  // Back press there must never fall through to the WebView's own history.
  const needsSentinel = isNativeApp() || Boolean(room || deepCode || enteredAsGuest) || canLeaveSite;

  // The URL the current screen should show. Re-arming pushes a fresh entry, and
  // without this it would inherit whatever URL the popped entry had — a Back
  // press inside a room used to rewrite the address bar from /r/CODE to /, so a
  // refresh afterwards dropped the user out of the room.
  const pathRef = useRef('/');
  pathRef.current = room ? `/r/${room.code}` : deepCode ? `/r/${deepCode}` : '/';

  // 'stayed' — we moved within the app, so hold on to the sentinel.
  // 'leaving' — a prompt is up whose confirm walks out of the site. Re-arming
  //   here would be self-defeating: the confirm's own history step would pop our
  //   fresh entry, fire popstate, and be swallowed as "dismiss the dialog".
  const backRef = useRef<() => 'stayed' | 'leaving'>(() => 'stayed');
  backRef.current = () => {
    // An open dialog absorbs Back (dismiss it) instead of stacking prompts.
    if (askExit || askLeave || askLogout) { setAskExit(false); setAskLeave(false); setAskLogout(false); return 'stayed'; }
    // Leaving a room is disruptive for everyone in it, so confirm first.
    if (room) { setAskLeave(true); return 'stayed'; }
    if (deepCode) { setDeepCode(null); return 'stayed'; }    // invite screen → lobby/auth
    if (enteredAsGuest && !user) { setEnteredAsGuest(false); return 'stayed'; } // guest lobby → sign in
    // Nothing of the app sits behind this screen. Back ends the session either
    // way; in a browser it also returns the user to the page they came from.
    if (user) {
      if (isNativeApp()) { setAskLogout('stay'); return 'stayed'; }
      setAskLogout('leave');
      return 'leaving';
    }
    // The sign-in screen: only reachable here when Back has somewhere to go.
    setAskExit(true);
    return isNativeApp() ? 'stayed' : 'leaving';
  };

  // A Back press consumes the sentinel, so re-arming has to happen after the
  // screen change it caused has been applied — this counter re-runs the effect
  // below against the new state instead of the state as it was mid-press.
  const [popTick, setPopTick] = useState(0);
  const needsRef = useRef(needsSentinel);
  needsRef.current = needsSentinel;
  // While one of these is up, the sentinel must stay consumed — see backRef.
  const leavePromptRef = useRef(false);
  leavePromptRef.current = !isNativeApp() && (askExit || askLogout === 'leave');

  useEffect(() => {
    if (needsSentinel && !isArmed()) window.history.pushState({ wlBack: true }, '', pathRef.current);
  }, [needsSentinel, popTick]);

  useEffect(() => {
    const arm = () => window.history.pushState({ wlBack: true }, '', pathRef.current);
    function onPop() {
      // Re-arm once the screen change is committed — unless a prompt is up that
      // will walk out of the site, which needs the entry left alone.
      if (backRef.current() === 'stayed') setPopTick((n) => n + 1);
    }
    // Coming back from the background (or a restored WebView) can leave us
    // without the sentinel — without this, the next Back closes the app and the
    // exit prompt never appears again.
    function reArm() {
      if (leavePromptRef.current) return;
      if (document.visibilityState === 'visible' && needsRef.current && !isArmed()) arm();
    }
    window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', reArm);
    window.addEventListener('pageshow', reArm);
    window.addEventListener('focus', reArm);
    // In the native app the hardware Back button is delivered here instead —
    // no dependence on the WebView's history stack, which is what broke after
    // relaunching the app.
    const offNative = onNativeBack(() => { backRef.current(); });
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

  // Dismissing a prompt restores the sentinel: the Back press that raised it
  // consumed one, and a "leaving" prompt deliberately left it that way.
  function dismissPrompt() {
    setAskExit(false);
    setAskLogout(false);
    setPopTick((n) => n + 1);
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
        onRequestLogout={() => setAskLogout('stay')}
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
        <div className="modal-backdrop" onClick={() => dismissPrompt()}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h3>Log out?</h3>
            <p className="muted">
              {askLogout === 'leave'
                ? "You'll be signed out and taken back to the page you came from."
                : "You'll need to sign in again."}
            </p>
            <div className="modal-actions">
              <button className="ghost sm-btn" onClick={() => dismissPrompt()}>Stay</button>
              <button className="primary sm-btn" onClick={() => {
                const leaves = askLogout === 'leave';
                setAskLogout(false);
                setEnteredAsGuest(false);
                // Sign out first, then step back out of the site — the order
                // matters, since navigating away cancels an in-flight request.
                void logout().finally(() => { if (leaves) window.history.back(); });
              }}>Log out</button>
            </div>
          </div>
        </div>
      )}

      {askExit && (
        <div className="modal-backdrop" onClick={() => dismissPrompt()}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h3>Leave Wavelength?</h3>
            <p className="muted">
              {isNativeApp() ? 'Close the app?' : "You'll go back to the page you came from."}
            </p>
            <div className="modal-actions">
              <button className="ghost sm-btn" onClick={() => dismissPrompt()}>Stay</button>
              <button className="primary sm-btn" onClick={() => {
                setAskExit(false);
                if (isNativeApp()) exitApp(); else window.history.back();
              }}>
                {isNativeApp() ? 'Exit' : 'Leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
