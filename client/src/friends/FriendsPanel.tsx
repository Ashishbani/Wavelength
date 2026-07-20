import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { usePresence } from './usePresence.js';
import { getFriends, getRequests, sendRequest, acceptRequest, declineRequest, unfriend, type FriendSummary, type PendingRequest } from './api.js';
import { ApiError } from '../auth/api.js';

export default function FriendsPanel({ onJoin }: { onJoin: (code: string) => void }) {
  const { user, setUsername } = useAuth();
  const presence = usePresence();
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incoming, setIncoming] = useState<PendingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
  const [handle, setHandle] = useState('');
  const [addName, setAddName] = useState('');
  const [error, setError] = useState('');

  async function refreshAll() {
    try {
      const [f, r] = await Promise.all([getFriends(), getRequests()]);
      setFriends(f.friends); setIncoming(r.incoming); setOutgoing(r.outgoing);
    } catch { /* NEEDS_HANDLE or not logged in — ignore */ }
  }

  useEffect(() => { if (user?.username) refreshAll(); }, [user?.username]);

  if (!user) return null;

  if (!user.username) {
    return (
      <div className="panel friends">
        <h3>Pick a handle to use friends</h3>
        <div className="add-song">
          <input placeholder="@handle (3–20)" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={20} />
          <button onClick={async () => {
            setError('');
            try { await setUsername(handle); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
          }}>Save</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  async function add() {
    setError('');
    try { await sendRequest(addName.replace(/^@/, '')); setAddName(''); await refreshAll(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
  }

  return (
    <div className="panel friends">
      <h3>Friends <small>(you are @{user.username})</small></h3>
      <div className="add-song">
        <input placeholder="Add by @handle" value={addName} onChange={(e) => setAddName(e.target.value)} maxLength={21} />
        <button onClick={add}>Send request</button>
      </div>
      {error && <p className="error">{error}</p>}

      {incoming.length > 0 && (
        <>
          <h4>Requests</h4>
          <ul>{incoming.map((r) => (
            <li key={r.id}>
              @{r.username} ({r.displayName})
              <span>
                <button onClick={async () => { await acceptRequest(r.id); await refreshAll(); }}>Accept</button>
                <button onClick={async () => { await declineRequest(r.id); await refreshAll(); }}>Decline</button>
              </span>
            </li>
          ))}</ul>
        </>
      )}

      <h4>Your friends</h4>
      <ul>{friends.map((f) => {
        const p = presence.get(f.userId);
        return (
          <li key={f.userId}>
            <span className={p?.online ? 'dot on' : 'dot'} /> @{f.username}
            {p?.roomCode && <button onClick={() => onJoin(p.roomCode!)}>Join room</button>}
            <button onClick={async () => { await unfriend(f.userId); await refreshAll(); }}>✕</button>
          </li>
        );
      })}</ul>

      {outgoing.length > 0 && <p className="muted">Pending: {outgoing.map((o) => `@${o.username}`).join(', ')}</p>}
    </div>
  );
}
