import { useEffect, useRef, useState } from 'react';
import type { CreateJoinResult, RoomState } from '@wavelength/shared';
import socket from './socket.js';
import { useAuth } from './auth/AuthContext.js';

function rememberedName(displayName?: string): string {
  if (displayName) return displayName;
  try { return localStorage.getItem('wl_name') ?? ''; } catch { return ''; }
}

export default function DeepJoin({
  code,
  onJoined,
  onCancel,
}: {
  code: string;
  onJoined: (s: RoomState, selfId: string) => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState(rememberedName(user?.displayName));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // True while we auto-rejoin after a page refresh (no prompt shown).
  const [rejoining, setRejoining] = useState(() => {
    try { return sessionStorage.getItem('wl_room') === code && !!rememberedName(user?.displayName); }
    catch { return false; }
  });
  const tried = useRef(false);

  function submitJoin(who: string) {
    setBusy(true); setError('');
    try { localStorage.setItem('wl_name', who); } catch { /* private mode */ }
    socket.emit('room:join', { code, name: who }, (res: CreateJoinResult) => {
      setBusy(false);
      setRejoining(false);
      if (res.ok) onJoined(res.state, res.selfId);
      else setError(res.error);
    });
  }

  // On a refresh of a room you were in, silently rejoin instead of prompting.
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    let wasHere = false;
    try { wasHere = sessionStorage.getItem('wl_room') === code; } catch { /* ignore */ }
    const who = rememberedName(user?.displayName).trim();
    if (wasHere && who) submitJoin(who);
    else setRejoining(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function join() {
    if (!name.trim()) return setError('Enter a name to join.');
    submitJoin(name.trim());
  }

  if (rejoining) {
    return (
      <div className="landing">
        <div className="brand">
          <div className="logo-row">
            <div className="logo-eq"><span /><span /><span /><span /></div>
            <h1 className="wordmark">Wavelength</h1>
          </div>
          <p className="tagline">Rejoining your room…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="landing">
      <div className="brand">
        <div className="logo-row">
          <div className="logo-eq"><span /><span /><span /><span /></div>
          <h1 className="wordmark">Wavelength</h1>
        </div>
        <p className="tagline">You've been invited to a listening room.</p>
      </div>

      <div className="card panel join-card">
        <h3>Join room <span className="room-code-chip">{code}</span></h3>
        <label>Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Alex"
            onKeyDown={(e) => { if (e.key === 'Enter') join(); }} />
        </label>
        <div className="join-actions">
          <button className="primary" onClick={join} disabled={busy}>Join the room</button>
          <button className="ghost" onClick={onCancel}>Not now</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
