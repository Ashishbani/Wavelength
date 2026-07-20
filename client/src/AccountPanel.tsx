import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiPost, apiDelete } from './auth/api.js';

interface SavedRoom { code: string; name: string; }
interface Playlist { id: string; name: string; items: { videoId: string; title: string }[]; }
interface HistoryEntry { videoId: string; title: string; playedAt: number; }

export default function AccountPanel({ onJoin }: { onJoin: (code: string) => void }) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<SavedRoom[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [newRoomName, setNewRoomName] = useState('');

  useEffect(() => {
    if (!user) return;
    apiGet<{ rooms: SavedRoom[] }>('/api/rooms').then((r) => setRooms(r.rooms)).catch(() => {});
    apiGet<{ playlists: Playlist[] }>('/api/playlists').then((r) => setPlaylists(r.playlists)).catch(() => {});
    apiGet<{ history: HistoryEntry[] }>('/api/history').then((r) => setHistory(r.history)).catch(() => {});
  }, [user]);

  if (!user) return null;

  async function createRoom() {
    if (!newRoomName.trim()) return;
    const r = await apiPost<SavedRoom>('/api/rooms', { name: newRoomName.trim() });
    setRooms((prev) => [{ code: r.code, name: r.name }, ...prev]);
    setNewRoomName('');
  }
  async function removeRoom(code: string) {
    await apiDelete(`/api/rooms/${code}`);
    setRooms((prev) => prev.filter((r) => r.code !== code));
  }

  return (
    <div className="account">
      <div className="card panel">
        <h3>Your saved rooms</h3>
        <div className="inline-add">
          <input placeholder="New room name" value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} maxLength={60} />
          <button className="primary" onClick={createRoom}>Create</button>
        </div>
        <ul className="list">{rooms.map((r) => (
          <li key={r.code} className="row">
            <span className="grow click" onClick={() => onJoin(r.code)}>{r.name} <small>· {r.code}</small></span>
            <button className="chip join" onClick={() => onJoin(r.code)}>Open</button>
            <button className="iconbtn" onClick={() => removeRoom(r.code)}>✕</button>
          </li>
        ))}</ul>
        {rooms.length === 0 && <p className="muted">No saved rooms yet.</p>}
      </div>

      <div className="card panel">
        <h3>Your playlists</h3>
        <ul className="list">{playlists.map((p) => (
          <li key={p.id} className="row"><span className="grow">{p.name}</span><span className="chip">{p.items.length} tracks</span></li>
        ))}</ul>
        {playlists.length === 0 && <p className="muted">Save a room's queue to create one.</p>}
      </div>

      <div className="card panel">
        <h3>Recently played</h3>
        <ul className="list">{history.slice(0, 20).map((h, i) => (
          <li key={i} className="row"><span className="grow">{h.title}</span></li>
        ))}</ul>
        {history.length === 0 && <p className="muted">Nothing yet — play some music.</p>}
      </div>
    </div>
  );
}
