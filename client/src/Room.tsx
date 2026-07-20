import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { RoomState, PlaybackState, ChatMessage } from '@wavelength/shared';
import { effectivePosition, isDrifted, isValidVideoId } from '@wavelength/shared';
import socket from './socket.js';
import YouTubePlayer, { type YTPlayerHandle } from './YouTubePlayer.js';
import { useClockOffset } from './useClockOffset.js';
import { parseVideoId } from './parseVideoId.js';
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiPost } from './auth/api.js';
import { getFriends, type FriendSummary } from './friends/api.js';
import { usePresence } from './friends/usePresence.js';

const AV_COLORS = ['#8b5cff', '#ff5ca8', '#3ddc97', '#ffb14e', '#4ea8ff', '#c65cff'];
function avatarColor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function initials(s: string): string {
  return (s.trim().slice(0, 2) || '?').toUpperCase();
}
function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Room({ initialState, selfId }: { initialState: RoomState; selfId: string }) {
  const [state, setState] = useState<RoomState>(initialState);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [tab, setTab] = useState<'queue' | 'chat'>('chat');
  const [isPlaying, setIsPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [title, setTitle] = useState('');
  const playerRef = useRef<YTPlayerHandle | null>(null);
  const playbackRef = useRef<PlaybackState>(initialState.playback);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const offset = useClockOffset();
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  const isHost = state.hostId === selfId;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (user && isHost) {
      apiGet<{ playlists: { id: string; name: string }[] }>('/api/playlists')
        .then((r) => setPlaylists(r.playlists))
        .catch(() => {});
    }
  }, [user, isHost]);

  async function saveQueueAsPlaylist() {
    const name = window.prompt('Playlist name?');
    if (!name) return;
    const items = state.queue.map((q) => ({ videoId: q.videoId, title: q.title }));
    if (state.playback.videoId) items.unshift({ videoId: state.playback.videoId, title: state.playback.videoId });
    await apiPost('/api/playlists', { name, items });
    const r = await apiGet<{ playlists: { id: string; name: string }[] }>('/api/playlists');
    setPlaylists(r.playlists);
  }

  function loadPlaylist(id: string) {
    socket.emit('queue:loadPlaylist', { playlistId: id });
  }

  const presence = usePresence();
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  useEffect(() => {
    if (user?.username && isHost) getFriends().then((r) => setFriends(r.friends)).catch(() => {});
  }, [user?.username, isHost]);

  function inviteFriend(userId: string) {
    socket.emit('invite:send', { toUserId: userId });
  }

  const onlineFriends = friends.filter((f) => presence.get(f.userId)?.online);

  // Apply server playback state to the local player.
  function applyPlayback(pb: PlaybackState) {
    playbackRef.current = pb;
    setIsPlaying(pb.isPlaying && !!pb.videoId);
    const player = playerRef.current;
    if (!player || !pb.videoId) return;
    const serverNow = Date.now() + offsetRef.current;
    const target = effectivePosition(pb, serverNow);
    if (isDrifted(player.getCurrentTime(), target)) player.seekTo(target);
    if (pb.isPlaying) player.play(); else player.pause();
  }

  useEffect(() => {
    socket.on('room:state', setState);
    socket.on('playback:update', applyPlayback);
    socket.on('chat:message', (m) => setMessages((prev) => [...prev, m].slice(-200)));
    return () => {
      socket.off('room:state', setState);
      socket.off('playback:update', applyPlayback);
      socket.off('chat:message');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll chat to the newest message.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  // Poll the player for the progress bar and track title.
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      setPos(p.getCurrentTime() || 0);
      setDur(p.getDuration() || 0);
      const t = p.getTitle();
      if (t) setTitle(t);
    }, 300);
    return () => clearInterval(id);
  }, []);

  // Host heartbeat: re-stamp position every 4s so late / drifting clients converge.
  useEffect(() => {
    if (!isHost) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (p && playbackRef.current.isPlaying) {
        socket.emit('playback:heartbeat', { positionSec: p.getCurrentTime() });
      }
    }, 4000);
    return () => clearInterval(id);
  }, [isHost]);

  function onPlayerReady(h: YTPlayerHandle) {
    playerRef.current = h;
    applyPlayback(playbackRef.current);
  }

  // The player is the source of truth for the DJ. When they play/pause via the
  // YouTube controls, push it to the server; listeners snap back to the shared
  // state. Changes that already match the server are our own sync — ignore them.
  function onPlayerStateChange(playing: boolean, positionSec: number) {
    if (playing === playbackRef.current.isPlaying) return;
    if (isHostRef.current) {
      if (playing) socket.emit('playback:play', { positionSec });
      else socket.emit('playback:pause', { positionSec });
    } else {
      const p = playerRef.current;
      if (!p) return;
      if (playbackRef.current.isPlaying) p.play(); else p.pause();
    }
  }

  // Host-only handlers
  function hostPlay() { socket.emit('playback:play', { positionSec: playerRef.current?.getCurrentTime() ?? 0 }); }
  function hostPause() { socket.emit('playback:pause', { positionSec: playerRef.current?.getCurrentTime() ?? 0 }); }
  function hostNext() { socket.emit('queue:next'); }

  function seek(e: MouseEvent<HTMLDivElement>) {
    if (!isHost || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const target = frac * dur;
    playerRef.current?.seekTo(target);
    socket.emit('playback:seek', { positionSec: target });
  }

  function addSong() {
    const id = parseVideoId(urlInput.trim());
    if (!isValidVideoId(id)) { setUrlInput(''); return; }
    socket.emit('queue:add', { videoId: id, title: id });
    setUrlInput('');
  }

  function sendChat() {
    const t = chatText.trim();
    if (!t) return;
    socket.emit('chat:send', { text: t });
    setChatText('');
  }

  const hasVideo = !!state.playback.videoId;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const npTitle = title || (hasVideo ? 'Now playing' : 'Nothing playing');
  const cover = state.playback.videoId ? `https://img.youtube.com/vi/${state.playback.videoId}/mqdefault.jpg` : null;

  return (
    <div className="room">
      <header className="room-head">
        <span className="wordmark">Wavelength</span>
        <span className="room-badge">Room <b>{state.code}</b></span>
        <span className="role">
          {isHost ? '🎧 You are the DJ' : 'Listening'}
          <span className="live-pill"><span className="beat" />IN SYNC</span>
        </span>
      </header>

      <div className="room-grid">
        <section className="stage">
          {hasVideo ? (
            <YouTubePlayer
              videoId={state.playback.videoId}
              onReady={onPlayerReady}
              onEnded={() => { if (isHostRef.current) hostNext(); }}
              onStateChange={onPlayerStateChange}
            />
          ) : (
            <div className="stage-empty">
              <div>
                <div className="logo-eq" style={{ margin: '0 auto 14px', height: 34 }}>
                  <span /><span /><span /><span />
                </div>
                <p><b>Queue up a track to get started</b></p>
                <p className="muted">Paste a YouTube link below — it plays for everyone, in sync.</p>
              </div>
            </div>
          )}

          <div className="card panel np-card">
            {cover && <div className="cover-bg" style={{ backgroundImage: `url(${cover})` }} />}
            <div className="nowplaying">
              {cover
                ? <img className="artwork" src={cover} alt="" />
                : <div className="artwork placeholder">🎵</div>}
              <div className="np-meta grow">
                <div className="np-title">{npTitle}</div>
                <div className="np-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={isPlaying ? 'eq playing' : 'eq'} style={{ height: 16, width: 22 }}><span /><span /><span /><span /></span>
                  {isPlaying ? 'Playing' : hasVideo ? 'Paused' : 'Add a song to begin'}
                </div>
              </div>
            </div>

            <div className="progress" style={{ marginTop: 14 }}>
              <span className="time">{fmtTime(pos)}</span>
              <div className={isHost ? 'track seekable' : 'track'} onClick={seek}>
                <div className="fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="time">{fmtTime(dur)}</span>
            </div>

            <div className="transport" style={{ marginTop: 14 }}>
              {isHost ? (
                <>
                  <button className="play-btn" onClick={isPlaying ? hostPause : hostPlay} title={isPlaying ? 'Pause' : 'Play'}>
                    {isPlaying ? '❚❚' : '▶'}
                  </button>
                  <button className="round-btn" onClick={hostNext} title="Skip">⏭</button>
                  <span className="spacer" />
                  {user && <button className="ghost" onClick={saveQueueAsPlaylist}>Save queue</button>}
                  {user && playlists.length > 0 && (
                    <select className="control-select" onChange={(e) => { if (e.target.value) loadPlaylist(e.target.value); e.target.value = ''; }} defaultValue="">
                      <option value="" disabled>Load playlist…</option>
                      {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                  {user && onlineFriends.length > 0 && (
                    <select className="control-select" onChange={(e) => { if (e.target.value) inviteFriend(e.target.value); e.target.value = ''; }} defaultValue="">
                      <option value="" disabled>Invite a friend…</option>
                      {onlineFriends.map((f) => <option key={f.userId} value={f.userId}>@{f.username}</option>)}
                    </select>
                  )}
                </>
              ) : (
                <span className="muted">Only the DJ controls playback — you're perfectly in sync.</span>
              )}
            </div>
          </div>

          <div className="card panel">
            <div className="addbar">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSong(); }}
                placeholder="Paste a YouTube link or 11-char id"
              />
              <button className="primary" onClick={addSong}>Add to queue</button>
            </div>
          </div>
        </section>

        <aside className="side">
          <div className="card panel">
            <h3>In the room <span className="count">· {state.members.length}</span></h3>
            <ul className="list">{state.members.map((m) => (
              <li key={m.id} className="row">
                <span className="avatar sm" style={{ background: avatarColor(m.name) }}>{initials(m.name)}</span>
                <span className="grow">{m.name}{m.id === selfId ? ' (you)' : ''}</span>
                {m.id === state.hostId && <span className="chip">DJ</span>}
              </li>
            ))}</ul>
          </div>

          <div className="card panel chat-panel">
            <div className="tabs">
              <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button>
              <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Up next · {state.queue.length}</button>
            </div>

            {tab === 'chat' ? (
              <>
                <div className="messages" ref={messagesRef}>
                  {messages.length === 0 && <div className="empty-hint">Say hi 👋 — messages appear here.</div>}
                  {messages.map((m, i) => (
                    <div key={i} className="msg">
                      <span className="avatar sm" style={{ background: avatarColor(m.name) }}>{initials(m.name)}</span>
                      <div>
                        <div className="who">{m.name}</div>
                        <div className="bubble">{m.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="chat-input">
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                    placeholder="Say something…"
                  />
                  <button className="primary" onClick={sendChat}>Send</button>
                </div>
              </>
            ) : (
              <ul className="list">
                {state.queue.length === 0 && <div className="empty-hint">The queue is empty — add a song.</div>}
                {state.queue.map((q, i) => (
                  <li key={i} className="row queue-item">
                    <span className="idx">{i + 1}</span>
                    <span className="grow">{q.title}</span>
                    <small>{q.addedBy}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
