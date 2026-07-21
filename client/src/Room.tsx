import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { RoomState, PlaybackState, ChatMessage } from '@wavelength/shared';
import { effectivePosition, isValidVideoId } from '@wavelength/shared';
import socket from './socket.js';
import YouTubePlayer, { type YTPlayerHandle } from './YouTubePlayer.js';
import { useClockOffset } from './useClockOffset.js';
import { parseVideoId } from './parseVideoId.js';
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiPost } from './auth/api.js';
import { getFriends, type FriendSummary } from './friends/api.js';
import { usePresence } from './friends/usePresence.js';
import { PrevIcon, NextIcon, PlayIcon, PauseIcon } from './room/icons.js';
import { fetchYouTubeTitle } from './lib/youtubeTitle.js';

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

export default function Room({
  initialState,
  selfId,
  onLeave,
}: {
  initialState: RoomState;
  selfId: string;
  onLeave: () => void;
}) {
  const [state, setState] = useState<RoomState>(initialState);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [tab, setTab] = useState<'queue' | 'chat' | 'people'>('chat');
  const [isPlaying, setIsPlaying] = useState(false);
  // What the local YouTube player is actually doing (vs. isPlaying = the shared
  // intent). On mobile, autoplay is blocked outside a tap, so these can diverge.
  const [localPlaying, setLocalPlaying] = useState(false);
  const [needTap, setNeedTap] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [title, setTitle] = useState('');
  const [copied, setCopied] = useState(false);
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
    if (user) {
      apiGet<{ playlists: { id: string; name: string }[] }>('/api/playlists')
        .then((r) => setPlaylists(r.playlists)).catch(() => {});
    }
  }, [user]);

  async function saveQueueAsPlaylist() {
    const name = window.prompt('Playlist name?');
    if (!name) return;
    const items = state.queue.map((q) => ({ videoId: q.videoId, title: q.title }));
    if (state.playback.videoId) items.unshift({ videoId: state.playback.videoId, title: title || state.playback.videoId });
    await apiPost('/api/playlists', { name, items });
    const r = await apiGet<{ playlists: { id: string; name: string }[] }>('/api/playlists');
    setPlaylists(r.playlists);
  }
  function loadPlaylist(id: string) { socket.emit('queue:loadPlaylist', { playlistId: id }); }

  const presence = usePresence();
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  useEffect(() => {
    if (user?.username) getFriends().then((r) => setFriends(r.friends)).catch(() => {});
  }, [user?.username]);
  function inviteFriend(userId: string) { socket.emit('invite:send', { toUserId: userId }); }
  const onlineFriends = friends.filter((f) => presence.get(f.userId)?.online);

  // Apply server playback to the local player.
  //  - hard (join / explicit play·pause·seek·skip): snap precisely, both directions.
  //  - gentle (periodic heartbeat): catch up if we're behind; tolerate being a bit
  //    ahead so we never repeatedly rewind. A big lead (>4s) still gets pulled back.
  function applyPlayback(pb: PlaybackState, hard = true) {
    playbackRef.current = pb;
    setIsPlaying(pb.isPlaying && !!pb.videoId);
    const player = playerRef.current;
    if (!player || !pb.videoId) return;

    const state = player.getState();
    const BUFFERING = 3, UNSTARTED = -1;
    const settling = state === BUFFERING || state === UNSTARTED;

    if (!settling) {
      const serverNow = Date.now() + offsetRef.current;
      const target = effectivePosition(pb, serverNow);
      const drift = player.getCurrentTime() - target; // >0 = we're ahead
      if (!pb.isPlaying) {
        if (Math.abs(drift) > 0.5) player.seekTo(target);
      } else if (hard) {
        if (Math.abs(drift) > 1) player.seekTo(target);
      } else if (drift < -1.2 || drift > 4) {
        player.seekTo(target);
      }
    }
    if (pb.isPlaying) player.play(); else player.pause();
  }

  useEffect(() => {
    const onUpdate = (pb: PlaybackState) => applyPlayback(pb, true);
    const onSync = (pb: PlaybackState) => applyPlayback(pb, false);
    socket.on('room:state', setState);
    socket.on('playback:update', onUpdate);
    socket.on('playback:sync', onSync);
    socket.on('chat:message', (m) => setMessages((prev) => [...prev, m].slice(-200)));
    return () => {
      socket.off('room:state', setState);
      socket.off('playback:update', onUpdate);
      socket.off('playback:sync', onSync);
      socket.off('chat:message');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

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

  useEffect(() => {
    if (!isHost) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (p && playbackRef.current.isPlaying) socket.emit('playback:heartbeat', { positionSec: p.getCurrentTime() });
    }, 4000);
    return () => clearInterval(id);
  }, [isHost]);

  function onPlayerReady(h: YTPlayerHandle) {
    playerRef.current = h;
    applyPlayback(playbackRef.current);
  }
  function onPlayerStateChange(playing: boolean, positionSec: number) {
    setLocalPlaying(playing);
    // Collaborative control: any member's play/pause (incl. via native YouTube
    // controls) is pushed to the room. Changes already matching the shared state
    // are our own sync — ignore them to avoid loops.
    if (playing === playbackRef.current.isPlaying) return;
    if (playing) socket.emit('playback:play', { positionSec });
    else socket.emit('playback:pause', { positionSec });
  }

  // If the room is playing but our player isn't (mobile autoplay block, or we
  // just joined mid-song), surface a "tap to play" prompt after a short grace so
  // desktop autoplay never flashes it. A real tap satisfies the mobile gesture.
  useEffect(() => {
    if (!(state.playback.videoId && isPlaying && !localPlaying)) { setNeedTap(false); return; }
    const t = window.setTimeout(() => setNeedTap(true), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, localPlaying, state.playback.videoId]);

  function resumeLocal() {
    const p = playerRef.current;
    if (!p) return;
    const target = effectivePosition(playbackRef.current, Date.now() + offsetRef.current);
    p.seekTo(target);
    p.play(); // inside the tap gesture, so mobile allows it
    setNeedTap(false);
  }

  function hostPlay() { socket.emit('playback:play', { positionSec: playerRef.current?.getCurrentTime() ?? 0 }); }
  function hostPause() { socket.emit('playback:pause', { positionSec: playerRef.current?.getCurrentTime() ?? 0 }); }
  // The transport button reflects and controls what OUR player is actually doing
  // (not just the shared intent), because on mobile the shared state can say
  // "playing" while our audio is blocked. Every branch drives the player inside
  // the tap gesture, which is what mobile requires to start audio.
  function togglePlay() {
    const p = playerRef.current;
    if (localPlaying) {
      // We're truly playing → pause for everyone.
      p?.pause(); hostPause();
    } else if (playbackRef.current.isPlaying) {
      // The room is rolling but our audio is stopped (mobile autoplay block, or
      // we joined mid-song) → just catch our player up locally, no re-broadcast.
      resumeLocal();
    } else {
      // The room is paused → start it for everyone.
      p?.play(); hostPlay();
    }
  }
  function hostNext() { socket.emit('queue:next'); }
  function restart() { playerRef.current?.seekTo(0); socket.emit('playback:seek', { positionSec: 0 }); }
  function vote(itemId: string) { socket.emit('queue:vote', { itemId }); }

  function seek(e: MouseEvent<HTMLDivElement>) {
    if (!dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const target = frac * dur;
    playerRef.current?.seekTo(target);
    socket.emit('playback:seek', { positionSec: target });
  }

  async function addSong() {
    const id = parseVideoId(urlInput.trim());
    if (!isValidVideoId(id)) { setUrlInput(''); return; }
    setUrlInput('');
    const title = (await fetchYouTubeTitle(id)) ?? id;
    socket.emit('queue:add', { videoId: id, title });
  }
  function sendChat() {
    const t = chatText.trim();
    if (!t) return;
    socket.emit('chat:send', { text: t });
    setChatText('');
  }
  function copyLink() {
    const url = `${window.location.origin}/r/${state.code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const me = state.members.find((m) => m.id === selfId);
  const myName = me?.name ?? user?.displayName ?? 'You';
  const hasVideo = !!state.playback.videoId;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const npTitle = title || (hasVideo ? 'Now playing' : 'Nothing playing');
  const cover = state.playback.videoId ? `https://img.youtube.com/vi/${state.playback.videoId}/mqdefault.jpg` : null;

  return (
    <div className="room">
      <header className="room-head">
        <span className="wordmark">Wavelength</span>
        <span className="room-badge">Room <b>{state.code}</b></span>
        <button className="ghost sm-btn" onClick={copyLink}>{copied ? '✓ Copied' : '🔗 Copy invite link'}</button>
        <span className="role">
          <span className="live-pill"><span className="beat" />IN SYNC</span>
          <span className="me-chip" title={user ? `Signed in as ${user.displayName}` : 'Guest'}>
            <span className="avatar sm" style={{ background: avatarColor(myName) }}>{initials(myName)}</span>
            <span className="me-name">{myName}{user?.username ? <small> @{user.username}</small> : null}</span>
            <span className="me-role">{isHost ? '🎧 host' : 'member'}</span>
          </span>
          <button className="ghost sm-btn" onClick={onLeave}>Leave</button>
        </span>
      </header>

      <div className="room-grid">
        <section className="stage">
          {hasVideo ? (
            <div className="player-shell">
              <YouTubePlayer
                videoId={state.playback.videoId}
                onReady={onPlayerReady}
                onEnded={() => { if (isHostRef.current) hostNext(); }}
                onStateChange={onPlayerStateChange}
              />
              {needTap && (
                <button className="tap-to-play" onClick={resumeLocal}>
                  <span className="tap-icon"><PlayIcon /></span>
                  <span>Tap to play in sync</span>
                </button>
              )}
            </div>
          ) : (
            <div className="stage-empty">
              <div>
                <div className="logo-eq" style={{ margin: '0 auto 14px', height: 34 }}><span /><span /><span /><span /></div>
                <p><b>Queue up a track to get started</b></p>
                <p className="muted">Add a YouTube link from the sidebar — it plays for everyone, in sync.</p>
              </div>
            </div>
          )}

          <div className="card panel np-card">
            {cover && <div className="cover-bg" style={{ backgroundImage: `url(${cover})` }} />}
            <div className="nowplaying">
              {cover ? <img className="artwork" src={cover} alt="" /> : <div className="artwork placeholder">🎵</div>}
              <div className="np-meta grow">
                <div className="np-title">{npTitle}</div>
                <div className="np-status">
                  <span className={isPlaying ? 'eq np-eq playing' : 'eq np-eq'}><span /><span /><span /><span /></span>
                  <span>{isPlaying ? 'Playing' : hasVideo ? 'Paused' : 'Add a song to begin'}</span>
                </div>
              </div>
            </div>

            <div className="progress" style={{ marginTop: 14 }}>
              <span className="time">{fmtTime(pos)}</span>
              <div className="track seekable" onClick={seek}><div className="fill" style={{ width: `${pct}%` }} /></div>
              <span className="time">{fmtTime(dur)}</span>
            </div>

            <div className="transport" style={{ marginTop: 14 }}>
              <button className="round-btn" onClick={restart} title="Restart track"><PrevIcon /></button>
              <button className="play-btn" onClick={togglePlay} title={localPlaying ? 'Pause' : 'Play'}>{localPlaying ? <PauseIcon /> : <PlayIcon />}</button>
              <button className="round-btn" onClick={hostNext} title="Next track"><NextIcon /></button>
            </div>
            {user && (
              <div className="transport-extra">
                <button className="ghost" onClick={saveQueueAsPlaylist}>Save queue</button>
                {playlists.length > 0 && (
                  <select className="control-select" onChange={(e) => { if (e.target.value) loadPlaylist(e.target.value); e.target.value = ''; }} defaultValue="">
                    <option value="" disabled>Load playlist…</option>
                    {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {onlineFriends.length > 0 && (
                  <select className="control-select" onChange={(e) => { if (e.target.value) inviteFriend(e.target.value); e.target.value = ''; }} defaultValue="">
                    <option value="" disabled>Invite a friend…</option>
                    {onlineFriends.map((f) => <option key={f.userId} value={f.userId}>@{f.username}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>

        </section>

        <aside className="side">
          <div className="card panel chat-panel">
            <div className="tabs">
              <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button>
              <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Up next · {state.queue.length}</button>
              <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>People · {state.members.length}</button>
            </div>

            {tab === 'chat' && (
              <>
                <div className="messages" ref={messagesRef}>
                  {messages.length === 0 && <div className="empty-hint">Say hi 👋 — messages appear here.</div>}
                  {messages.map((m, i) => (
                    <div key={i} className="msg">
                      <span className="avatar sm" style={{ background: avatarColor(m.name) }}>{initials(m.name)}</span>
                      <div><div className="who">{m.name}</div><div className="bubble">{m.text}</div></div>
                    </div>
                  ))}
                </div>
                <div className="chat-input">
                  <input value={chatText} onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }} placeholder="Say something…" />
                  <button className="primary" onClick={sendChat}>Send</button>
                </div>
              </>
            )}

            {tab === 'queue' && (
              <ul className="list scroll">
                {state.queue.length === 0 && <div className="empty-hint">The queue is empty — add a song, or vote one up.</div>}
                {state.queue.map((q, i) => (
                  <li key={q.id} className="row queue-item">
                    <span className="idx">{i + 1}</span>
                    <span className="grow">{q.title} <small>· {q.addedBy}</small></span>
                    <button className="vote" onClick={() => vote(q.id)} title="Upvote">▲ {q.votes}</button>
                  </li>
                ))}
              </ul>
            )}

            {tab === 'people' && (
              <ul className="list scroll">
                {state.members.map((m) => (
                  <li key={m.id} className="row">
                    <span className="avatar sm" style={{ background: avatarColor(m.name) }}>{initials(m.name)}</span>
                    <span className="grow">{m.name}{m.id === selfId ? ' (you)' : ''}</span>
                    {m.id === state.hostId && <span className="chip">DJ</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card panel">
            <div className="addbar">
              <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSong(); }}
                placeholder="Paste a YouTube link…" />
              <button className="primary" onClick={addSong}>Add to queue</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
