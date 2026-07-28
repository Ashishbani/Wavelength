import { useEffect, useState, type ChangeEvent } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiDelete, apiUpload } from './auth/api.js';
import { WaveIcon, AddSongIcon, HeartIcon, PlayIcon } from './room/icons.js';
import { listFavourites, removeFavourite, type Favourite } from './lib/favourites.js';
import type { TrackKind } from '@wavelength/shared';

interface SavedRoom { code: string; name: string; }
interface Playlist { id: string; name: string; items: { videoId: string; title: string }[]; }
interface HistoryEntry { videoId: string; title: string; playedAt: number; }
interface Track { id: string; title: string; }

export default function AccountPanel({
  onJoin,
  onPlayPlaylist,
  onPlayTrack,
}: {
  onJoin: (code: string) => void;
  onPlayPlaylist: (playlistId: string) => void;
  onPlayTrack: (t: { videoId: string; title: string; kind?: TrackKind }) => void;
}) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<SavedRoom[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  useEffect(() => {
    if (!user) return;
    apiGet<{ rooms: SavedRoom[] }>('/api/rooms').then((r) => setRooms(r.rooms)).catch(() => {});
    apiGet<{ playlists: Playlist[] }>('/api/playlists').then((r) => setPlaylists(r.playlists)).catch(() => {});
    apiGet<{ history: HistoryEntry[] }>('/api/history').then((r) => setHistory(r.history)).catch(() => {});
    apiGet<{ tracks: Track[] }>('/api/library').then((r) => setTracks(r.tracks)).catch(() => {});
    listFavourites().then((r) => setFavourites(r.favourites)).catch(() => {});
  }, [user]);

  if (!user) return null;

  async function removeRoom(code: string) {
    await apiDelete(`/api/rooms/${code}`);
    setRooms((prev) => prev.filter((r) => r.code !== code));
  }
  async function removePlaylist(id: string) {
    await apiDelete(`/api/playlists/${id}`);
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
  }
  async function unfavourite(videoId: string) {
    await removeFavourite(videoId);
    setFavourites((prev) => prev.filter((f) => f.videoId !== videoId));
  }
  async function removeTrack(id: string) {
    await apiDelete(`/api/library/${id}`);
    setTracks((prev) => prev.filter((t) => t.id !== id));
  }
  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Untitled';
      await apiUpload(`/api/library?title=${encodeURIComponent(title)}`, file, setUploadPct);
      const r = await apiGet<{ tracks: Track[] }>('/api/library');
      setTracks(r.tracks);
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  return (
    <div className="account">
      {rooms.length > 0 && (
        <div className="card panel">
          <h3>Your saved rooms</h3>
          <ul className="list">{rooms.map((r) => (
            <li key={r.code} className="row">
              <span className="grow click" onClick={() => onJoin(r.code)}>{r.name} <small>· {r.code}</small></span>
              <button className="chip join" onClick={() => onJoin(r.code)}>Open</button>
              <button className="iconbtn" onClick={() => removeRoom(r.code)}>✕</button>
            </li>
          ))}</ul>
        </div>
      )}

      {favourites.length > 0 && (
        <div className="card panel">
          <h3>Favourites</h3>
          <ul className="list">{favourites.map((f) => (
            <li key={f.videoId} className="row">
              <span className="fav-mark"><HeartIcon filled size={12} /></span>
              <span className="grow">{f.title}</span>
              <button className="chip join" onClick={() => onPlayTrack(f)} title="Play in a new room">Play</button>
              <button className="iconbtn" onClick={() => void unfavourite(f.videoId)} title="Remove from favourites">✕</button>
            </li>
          ))}</ul>
        </div>
      )}

      <div className="card panel">
        <h3>My Music</h3>
        <ul className="list">{tracks.map((t) => (
          <li key={t.id} className="row">
            <span className="lib-mark"><WaveIcon size={12} /></span>
            <span className="grow">{t.title}</span>
            <button className="chip join" onClick={() => onPlayTrack({ videoId: t.id, title: t.title, kind: 'lib' })} title="Play in a new room">Play</button>
            <button className="iconbtn" onClick={() => removeTrack(t.id)} title="Delete track">✕</button>
          </li>
        ))}</ul>
        {tracks.length === 0 && <p className="muted">Songs you upload play in any room — and keep playing with the screen off.</p>}
        <label className={uploading ? 'upload-btn busy' : 'upload-btn'}>
          {uploading && <span className="upload-fill" style={{ width: `${uploadPct}%` }} />}
          <span className="upload-label">
            {uploading
              ? (uploadPct >= 100 ? 'Saving…' : `Uploading… ${uploadPct}%`)
              : <><AddSongIcon /> Upload a song · mp3 / m4a, up to 12 MB</>}
          </span>
          <input type="file" accept="audio/*" hidden onChange={onPickFile} disabled={uploading} />
        </label>
      </div>

      <div className="card panel">
        <h3>Your playlists</h3>
        <ul className="list">{playlists.map((p) => (
          <li key={p.id} className="row">
            <span className="grow">{p.name}</span>
            <span className="chip">{p.items.length} tracks</span>
            <button className="chip join" onClick={() => onPlayPlaylist(p.id)} title="Start a room with this playlist">
              <PlayIcon /> Play
            </button>
            <button className="iconbtn" onClick={() => removePlaylist(p.id)} title="Delete playlist">✕</button>
          </li>
        ))}</ul>
        {playlists.length === 0 && <p className="muted">Save a room's queue to create one.</p>}
      </div>

      <div className="card panel">
        <h3>Recently played</h3>
        <ul className="list">{history.slice(0, 20).map((h, i) => (
          <li key={i} className="row">
            <span className="grow">{h.title}</span>
            <button className="chip join" onClick={() => onPlayTrack({ videoId: h.videoId, title: h.title })} title="Play again in a new room">Play</button>
          </li>
        ))}</ul>
        {history.length === 0 && <p className="muted">Nothing yet — play some music.</p>}
      </div>
    </div>
  );
}
