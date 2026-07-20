import { useState } from 'react';
import type { CreateJoinResult, RoomState } from '@wavelength/shared';
import socket from './socket.js';
import { useAuth } from './auth/AuthContext.js';

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
  const [name, setName] = useState(user?.displayName ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function join() {
    if (!name.trim()) return setError('Enter a name to join.');
    setBusy(true); setError('');
    socket.emit('room:join', { code, name: name.trim() }, (res: CreateJoinResult) => {
      setBusy(false);
      if (res.ok) onJoined(res.state, res.selfId);
      else setError(res.error);
    });
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
