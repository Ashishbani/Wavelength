import { useState } from 'react';
import type { CreateJoinResult, RoomState } from '@wavelength/shared';
import socket from './socket.js';

export default function Landing({ onJoined }: { onJoined: (s: RoomState, selfId: string) => void }) {
  const [name, setName] = useState('');
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

  return (
    <div className="landing">
      <h1>Wavelength</h1>
      <p className="tagline">Get on the same wavelength.</p>
      <label>Your name<br />
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Alex" />
      </label>
      <div className="actions">
        <button onClick={create} disabled={busy}>Create a room</button>
      </div>
      <div className="join-row">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={6} />
        <button onClick={join} disabled={busy}>Join</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
