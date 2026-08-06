import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiDelete } from './auth/api.js';
import { HeartIcon } from './room/icons.js';
import { listFavourites, removeFavourite, type Favourite } from './lib/favourites.js';
import type { TrackKind } from '@wavelength/shared';
import { groupPlaysByDay, timeLabel, topTracks } from './lib/groupPlays.js';

interface SavedRoom { code: string; name: string; }
interface Playlist { id: string; name: string; items: { videoId: string; title: string }[]; }
interface HistoryEntry { videoId: string; title: string; playedAt: number; }

type LibTab = 'saved' | 'playlists' | 'top' | 'history';
type Range = 'all' | 'today' | 'week';
const RANGES: { key: Range; label: string; days: number | null }[] = [
  { key: 'all', label: 'All', days: null },
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: '7 days', days: 7 },
];

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
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [range, setRange] = useState<Range>('all');

  /** Start of the selected range, in local time (0 = all time). */
  function rangeCutoff(): number {
    const days = RANGES.find((r) => r.key === range)?.days;
    if (!days) return 0;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return d.getTime() - (days - 1) * 86_400_000;
  }
  const rangeChips = (
    <div className="range-chips">
      {RANGES.map((r) => (
        <button key={r.key} className={range === r.key ? 'chip on' : 'chip'} onClick={() => setRange(r.key)}>{r.label}</button>
      ))}
    </div>
  );

  useEffect(() => {
    if (!user) return;
    apiGet<{ rooms: SavedRoom[] }>('/api/rooms').then((r) => setRooms(r.rooms)).catch(() => {});
    apiGet<{ playlists: Playlist[] }>('/api/playlists').then((r) => setPlaylists(r.playlists)).catch(() => {});
    apiGet<{ history: HistoryEntry[] }>('/api/history').then((r) => setHistory(r.history)).catch(() => {});
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
          <button className={tab === 'playlists' ? 'active' : ''} onClick={() => setTab('playlists')}>Playlists</button>
          <button className={tab === 'top' ? 'active' : ''} onClick={() => setTab('top')}>Top</button>
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

        {tab === 'top' && (() => {
          const top = topTracks(history, rangeCutoff(), 10);
          const most = top[0]?.plays ?? 0;
          return (
            <>
              {rangeChips}
              <ul className="list lib-scroll top-list">{top.map((t, i) => (
                <li key={t.videoId} className="row top-row">
                  <span className={i < 3 ? 'rank medal' : 'rank'}>{i + 1}</span>
                  <span className="grow">
                    {t.title}
                    <span className="top-bar"><span style={{ width: `${most ? (t.plays / most) * 100 : 0}%` }} /></span>
                  </span>
                  <span className="chip plays">{t.plays} play{t.plays === 1 ? '' : 's'}</span>
                  <button className="chip join" onClick={() => onPlayTrack({ videoId: t.videoId, title: t.title })} title="Play again">Play</button>
                </li>
              ))}</ul>
              {top.length === 0 && (
                <p className="empty-hint">{history.length === 0 ? 'Play some music and your most-played tracks land here.' : 'Nothing played in this range.'}</p>
              )}
            </>
          );
        })()}

        {tab === 'history' && (() => {
          // Grouped by the day you listened, with repeats inside a day collapsed
          // to one row and a ×N count — a flat list repeated the same title.
          const days = groupPlaysByDay(history.filter((h) => h.playedAt >= rangeCutoff()));
          return (
            <>
              {rangeChips}
              <div className="lib-scroll">
                {days.map((d) => (
                  <div key={d.key} className="play-day">
                    <h4 className="day-head">{d.label}<span className="count"> · {d.items.length}</span></h4>
                    <ul className="list">{d.items.map((h) => (
                      <li key={h.videoId} className="row">
                        <span className="grow">{h.title}</span>
                        {h.plays > 1 && <span className="chip plays" title={`Played ${h.plays} times`}>×{h.plays}</span>}
                        <small className="play-time">{timeLabel(h.playedAt)}</small>
                        <button className="chip join" onClick={() => onPlayTrack({ videoId: h.videoId, title: h.title })} title="Play again">Play</button>
                      </li>
                    ))}</ul>
                  </div>
                ))}
              </div>
              {days.length === 0 && (
                <p className="empty-hint">{history.length === 0 ? 'Songs you play show up here.' : 'Nothing played in this range.'}</p>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
