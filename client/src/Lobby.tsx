import { useState } from 'react';
import type { CreateJoinResult, RoomState } from '@wavelength/shared';
import socket from './socket.js';
import { useAuth } from './auth/AuthContext.js';
import AccountPanel from './AccountPanel.js';
import FriendsPanel from './friends/FriendsPanel.js';
import Toasts from './friends/Toasts.js';

export default function Lobby({
  onJoined,
  onBackToAuth,
}: {
  onJoined: (s: RoomState, selfId: string) => void;
  onBackToAuth: () => void;
}) {
  const { user, logout } = useAuth();
  const [name, setName] = useState(user?.displayName ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function handle(res: CreateJoinResult) {
    setBusy(false);
    if (res.ok) onJoined(res.state, res.selfId);
    else setError(res.error);
  }

  function create() {
    if (!name.trim()) return setError('Enter a name first.');
    setBusy(true); setError('');
    socket.emit('room:create', { name: name.trim() }, handle);
  }

  function join() {
    if (!name.trim()) return setError('Enter a name first.');
    if (!code.trim()) return setError('Enter a room code.');
    setBusy(true); setError('');
    socket.emit('room:join', { code: code.trim(), name: name.trim() }, handle);
  }

  function joinByCode(roomCode: string) {
    if (!name.trim()) { setError('Enter a name first, then open the room.'); return; }
    setBusy(true); setError('');
    socket.emit('room:join', { code: roomCode, name: name.trim() }, handle);
  }

  const initials = (user?.displayName ?? 'G').slice(0, 2).toUpperCase();

  return (
    <div className="landing">
      <Toasts onJoin={joinByCode} />

      <div className="card lobby-bar">
        <span className="who">
          <span className="avatar sm" style={{ background: user ? '#8b5cff' : '#4a4a68' }}>{initials}</span>
          {user
            ? <span>Signed in as <b>{user.displayName}</b>{user.username ? <small> · @{user.username}</small> : null}</span>
            : <span>Listening as a <b>guest</b></span>}
        </span>
        {user
          ? <button className="ghost" onClick={() => logout()}>Log out</button>
          : <button className="ghost" onClick={onBackToAuth}>Log in / Sign up</button>}
      </div>

      <div className="card panel">
        <h3 style={{ marginBottom: 12 }}>Start listening</h3>
        <label>Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Alex" />
        </label>
        <div className="actions">
          <button className="primary" onClick={create} disabled={busy}>Create a room</button>
        </div>
        <div className="divider">or join with a code</div>
        <div className="join-row">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={6} />
          <button onClick={join} disabled={busy}>Join</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {user && <AccountPanel onJoin={joinByCode} />}
      {user && <FriendsPanel onJoin={joinByCode} />}

      {!user && (
        <p className="muted" style={{ textAlign: 'center' }}>
          Want saved rooms, playlists, and friends? <button className="link" onClick={onBackToAuth}>Create an account</button>.
        </p>
      )}
    </div>
  );
}
