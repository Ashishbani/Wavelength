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
      <div className="card panel friends">
        <h3>Pick a handle to use friends</h3>
        <div className="inline-add">
          <input placeholder="@handle (3–20)" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={20} />
          <button className="primary" onClick={async () => {
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
    <div className="card panel friends">
      <h3>Friends <small>· you are @{user.username}</small></h3>
      <div className="inline-add">
        <input placeholder="Add by @handle" value={addName} onChange={(e) => setAddName(e.target.value)} maxLength={21} />
        <button className="primary" onClick={add}>Add</button>
      </div>
      {error && <p className="error">{error}</p>}

      {incoming.length > 0 && (
        <>
          <h4>Requests</h4>
          <ul className="list">{incoming.map((r) => (
            <li key={r.id} className="row">
              <span className="avatar sm" style={{ background: '#4ea8ff' }}>{(r.username ?? '?').slice(0, 2).toUpperCase()}</span>
              <span className="grow">@{r.username}</span>
              <button className="chip join" onClick={async () => { await acceptRequest(r.id); await refreshAll(); }}>Accept</button>
              <button className="iconbtn" onClick={async () => { await declineRequest(r.id); await refreshAll(); }}>✕</button>
            </li>
          ))}</ul>
        </>
      )}

      <h4>Your friends</h4>
      <ul className="list">{friends.map((f) => {
        const p = presence.get(f.userId);
        return (
          <li key={f.userId} className="row">
            <span className={p?.online ? 'dot on' : 'dot'} />
            <span className="grow">@{f.username}{p?.roomCode ? <small> · in a room</small> : p?.online ? <small> · online</small> : ''}</span>
            {p?.roomCode && <button className="chip join" onClick={() => onJoin(p.roomCode!)}>Join</button>}
            <button className="iconbtn" onClick={async () => { await unfriend(f.userId); await refreshAll(); }}>✕</button>
          </li>
        );
      })}</ul>
      {friends.length === 0 && <p className="muted">No friends yet — add someone by their @handle.</p>}

      {outgoing.length > 0 && <p className="muted">Pending: {outgoing.map((o) => `@${o.username}`).join(', ')}</p>}
    </div>
  );
}
