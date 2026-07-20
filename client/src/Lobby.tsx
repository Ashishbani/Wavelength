import { useState } from 'react';
import type { CreateJoinResult, RoomState } from '@wavelength/shared';
import socket from './socket.js';
import { useAuth } from './auth/AuthContext.js';
import AccountPanel from './AccountPanel.js';
import FriendsPanel from './friends/FriendsPanel.js';
import Toasts from './friends/Toasts.js';
import { useLobbyRooms } from './lib/useLobbyRooms.js';

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
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const liveRooms = useLobbyRooms();

  function remember() {
    try { localStorage.setItem('wl_name', name.trim()); } catch { /* private mode */ }
  }
  function handle(res: CreateJoinResult) {
    setBusy(false);
    if (res.ok) onJoined(res.state, res.selfId);
    else setError(res.error);
  }
  function create() {
    if (!name.trim()) return setError('Enter a name first.');
    setBusy(true); setError(''); remember();
    socket.emit('room:create', { name: name.trim(), isPublic }, handle);
  }
  function join() {
    if (!name.trim()) return setError('Enter a name first.');
    if (!code.trim()) return setError('Enter a room code.');
    setBusy(true); setError(''); remember();
    socket.emit('room:join', { code: code.trim(), name: name.trim() }, handle);
  }
  function joinByCode(roomCode: string) {
    if (!name.trim()) { setError('Enter a name first, then open the room.'); return; }
    setBusy(true); setError(''); remember();
    socket.emit('room:join', { code: roomCode, name: name.trim() }, handle);
  }

  const initials = (user?.displayName ?? 'G').slice(0, 2).toUpperCase();

  return (
    <div className="lobby">
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

      <div className="lobby-grid">
        <div className="lobby-main">
          <div className="card panel">
            <h3 style={{ marginBottom: 12 }}>Start listening</h3>
            <label>Your name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Alex" />
            </label>
            <label className="check">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              <span>List my room in Explore so anyone can drop in</span>
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

          <div className="card panel explore">
            <h3>Explore live rooms <span className="count">· {liveRooms.length}</span></h3>
            {liveRooms.length === 0 ? (
              <p className="empty-hint">No public rooms right now — be the first to start one! 🎶</p>
            ) : (
              <div className="room-cards">
                {liveRooms.map((r) => (
                  <button key={r.code} className="room-card" onClick={() => joinByCode(r.code)}>
                    <div className="rc-top">
                      <span className={r.nowPlaying ? 'eq playing' : 'eq'}><span /><span /><span /><span /></span>
                      <span className={r.nowPlaying ? 'rc-live on' : 'rc-live'}>{r.nowPlaying ? 'LIVE' : 'idle'}</span>
                    </div>
                    <div className="rc-name">{r.name}</div>
                    <div className="rc-meta">{r.memberCount} listening · {r.code}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="lobby-side">
          {user ? (
            <>
              <AccountPanel onJoin={joinByCode} />
              <FriendsPanel onJoin={joinByCode} />
            </>
          ) : (
            <div className="card panel">
              <h3>Get more with an account</h3>
              <ul className="perks">
                <li>💾 Save rooms & playlists</li>
                <li>🕑 Listening history</li>
                <li>👥 Friends & presence</li>
              </ul>
              <button className="primary" style={{ width: '100%' }} onClick={onBackToAuth}>Create an account</button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
