import { useEffect, useState, type ChangeEvent } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiDelete, apiUpload } from './auth/api.js';
import { WaveIcon, AddSongIcon, HeartIcon } from './room/icons.js';
import { listFavourites, removeFavourite, type Favourite } from './lib/favourites.js';
import type { TrackKind } from '@wavelength/shared';

interface SavedRoom { code: string; name: string; }
interface Playlist { id: string; name: string; items: { videoId: string; title: string }[]; }
interface HistoryEntry { videoId: string; title: string; playedAt: number; }
interface Track { id: string; title: string; }

type LibTab = 'saved' | 'uploads' | 'playlists' | 'history';

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
  const [tab, setTab] = useState<LibTab>('saved');
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
          <h3>Your rooms</h3>
          <ul className="list">{rooms.map((r) => (
            <li key={r.code} className="row">
              <span className="grow click" onClick={() => onJoin(r.code)}>{r.name} <small>· {r.code}</small></span>
              <button className="chip join" onClick={() => onJoin(r.code)}>Open</button>
              <button className="iconbtn" onClick={() => removeRoom(r.code)}>✕</button>
            </li>
          ))}</ul>
        </div>
      )}

      {/* One library card with tabs — four stacked cards made the sidebar a
          long scroll on phones, and hid Favourites entirely when empty. */}
      <div className="card panel library">
        <h3>Your library</h3>
        <div className="tabs lib-tabs">
          <button className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>
            <HeartIcon filled={tab === 'saved'} size={13} /> Saved
          </button>
          <button className={tab === 'uploads' ? 'active' : ''} onClick={() => setTab('uploads')}>Uploads</button>
          <button className={tab === 'playlists' ? 'active' : ''} onClick={() => setTab('playlists')}>Playlists</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
        </div>

        {tab === 'saved' && (
          <>
            <ul className="list lib-scroll">{favourites.map((f) => (
              <li key={f.videoId} className="row">
                <span className="fav-mark"><HeartIcon filled size={12} /></span>
                <span className="grow">{f.title}</span>
                <button className="chip join" onClick={() => onPlayTrack(f)} title="Play in a new room">Play</button>
                <button className="iconbtn" onClick={() => void unfavourite(f.videoId)} title="Remove">✕</button>
              </li>
            ))}</ul>
            {favourites.length === 0 && (
              <p className="empty-hint">Tap <b>Save</b> on a playing song and it lands here — ready to play again in one tap.</p>
            )}
          </>
        )}

        {tab === 'uploads' && (
          <>
            <ul className="list lib-scroll">{tracks.map((t) => (
              <li key={t.id} className="row">
                <span className="lib-mark"><WaveIcon size={12} /></span>
                <span className="grow">{t.title}</span>
                <button className="chip join" onClick={() => onPlayTrack({ videoId: t.id, title: t.title, kind: 'lib' })} title="Play in a new room">Play</button>
                <button className="iconbtn" onClick={() => removeTrack(t.id)} title="Delete">✕</button>
              </li>
            ))}</ul>
            {tracks.length === 0 && (
              <p className="empty-hint">Your own songs — these keep playing in the background, even with the screen off.</p>
            )}
            <label className={uploading ? 'upload-btn busy' : 'upload-btn'}>
              {uploading && <span className="upload-fill" style={{ width: `${uploadPct}%` }} />}
              <span className="upload-label">
                {uploading
                  ? (uploadPct >= 100 ? 'Saving…' : `Uploading… ${uploadPct}%`)
                  : <><AddSongIcon /> Upload a song · mp3 / m4a, up to 12 MB</>}
              </span>
              <input type="file" accept="audio/*" hidden onChange={onPickFile} disabled={uploading} />
            </label>
          </>
        )}

        {tab === 'playlists' && (
          <>
            <ul className="list lib-scroll">{playlists.map((p) => (
              <li key={p.id} className="row">
                <span className="grow">{p.name}</span>
                <span className="chip">{p.items.length}</span>
                <button className="chip join" onClick={() => onPlayPlaylist(p.id)} title="Start a room with this playlist">Play</button>
                <button className="iconbtn" onClick={() => removePlaylist(p.id)} title="Delete">✕</button>
              </li>
            ))}</ul>
            {playlists.length === 0 && <p className="empty-hint">Save a room's queue to create a playlist.</p>}
          </>
        )}

        {tab === 'history' && (
          <>
            <ul className="list lib-scroll">{history.slice(0, 30).map((h, i) => (
              <li key={i} className="row">
                <span className="grow">{h.title}</span>
                <button className="chip join" onClick={() => onPlayTrack({ videoId: h.videoId, title: h.title })} title="Play again">Play</button>
              </li>
            ))}</ul>
            {history.length === 0 && <p className="empty-hint">Songs you play show up here.</p>}
          </>
        )}
      </div>
    </div>
  );
}
