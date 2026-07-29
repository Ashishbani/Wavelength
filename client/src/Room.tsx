import { useEffect, useRef, useState, type MouseEvent, type ChangeEvent } from 'react';
import type { RoomState, PlaybackState, ChatMessage, CreateJoinResult } from '@wavelength/shared';
import { effectivePosition, isValidVideoId } from '@wavelength/shared';
import socket from './socket.js';
import YouTubePlayer, { type YTPlayerHandle } from './YouTubePlayer.js';
import AudioPlayer from './AudioPlayer.js';
import { useClockOffset } from './useClockOffset.js';
import { parseVideoId } from './parseVideoId.js';
import { useAuth } from './auth/AuthContext.js';
import { apiGet, apiPost, apiDelete, apiUpload } from './auth/api.js';
import { getFriends, type FriendSummary } from './friends/api.js';
import { usePresence } from './friends/usePresence.js';
import { PrevIcon, NextIcon, PlayIcon, PauseIcon, AddSongIcon, LinkIcon, LeaveIcon, WaveIcon, EqBars, HeartIcon } from './room/icons.js';
import { fetchYouTubeTitle } from './lib/youtubeTitle.js';
import { clientSessionId } from './lib/session.js';
import { listFavourites, addFavourite, removeFavourite } from './lib/favourites.js';

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
  selfId: initialSelfId,
  onLeave,
}: {
  initialState: RoomState;
  selfId: string;
  onLeave: () => void;
}) {
  const [state, setState] = useState<RoomState>(initialState);
  // Our member id is the socket id, which CHANGES when the socket reconnects
  // (network blip, backgrounded mobile tab) — so it's state, updated on rejoin.
  const [selfId, setSelfId] = useState(initialSelfId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [tab, setTab] = useState<'queue' | 'chat' | 'people'>('chat');
  const [addMode, setAddMode] = useState<'yt' | 'lib'>('yt');
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
  // Mirrors for the reconnect handler (registered once, needs current values).
  const codeRef = useRef(initialState.code);
  const myNameRef = useRef('');
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const sideRef = useRef<HTMLElement | null>(null);
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

  // My Music — uploaded tracks that play via <audio>, which (unlike YouTube
  // embeds) keeps playing in the background and with the screen off.
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [library, setLibrary] = useState<{ id: string; title: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  useEffect(() => {
    if (user) {
      listFavourites().then((r) => setFavIds(new Set(r.favourites.map((f) => f.videoId)))).catch(() => {});
    }
  }, [user]);

  // Save/unsave the current track. Optimistic so the heart responds instantly.
  async function toggleFavourite() {
    const vid = state.playback.videoId;
    if (!vid) return;
    const wasFav = favIds.has(vid);
    setFavIds((prev) => {
      const next = new Set(prev);
      if (wasFav) next.delete(vid); else next.add(vid);
      return next;
    });
    try {
      if (wasFav) await removeFavourite(vid);
      else await addFavourite(vid, title || state.playback.title || vid, state.playback.kind ?? 'yt');
    } catch {
      setFavIds((prev) => { // revert on failure
        const next = new Set(prev);
        if (wasFav) next.add(vid); else next.delete(vid);
        return next;
      });
    }
  }

  useEffect(() => {
    if (user) {
      apiGet<{ tracks: { id: string; title: string }[] }>('/api/library')
        .then((r) => setLibrary(r.tracks)).catch(() => {});
    }
  }, [user]);
  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const trackTitle = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Untitled';
      const up = await apiUpload<{ id: string; title: string }>(`/api/library?title=${encodeURIComponent(trackTitle)}`, file, setUploadPct);
      const r = await apiGet<{ tracks: { id: string; title: string }[] }>('/api/library');
      setLibrary(r.tracks);
      // Freshly uploaded music should just play — queue it immediately.
      addLibTrack(up);
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }
  function addLibTrack(t: { id: string; title: string }) {
    socket.emit('queue:add', { videoId: t.id, title: t.title, kind: 'lib' });
  }
  async function deleteTrack(id: string) {
    try {
      await apiDelete(`/api/library/${id}`);
      setLibrary((l) => l.filter((t) => t.id !== id));
    } catch { /* already gone */ }
  }

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
    // Enforce "play" only on hard (explicit) updates — a periodic gentle tick
    // must never override a pause the user just pressed while its confirmation
    // is still pending. Enforcing "pause" is always safe.
    if (pb.isPlaying) { if (hard) player.play(); }
    else player.pause();
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

  // Socket.IO reconnects automatically after a network blip or a backgrounded
  // mobile tab — but the new connection has a new identity and is NOT a member
  // of the room anymore: controls would be silently ignored and updates would
  // stop arriving (stale member list, growing drift). Re-join with our seat,
  // which evicts the stale member entry and reclaims host if we held it.
  useEffect(() => {
    const rejoin = () => {
      socket.emit(
        'room:join',
        { code: codeRef.current, name: myNameRef.current, clientId: clientSessionId() },
        (res: CreateJoinResult) => {
          if (res.ok) {
            setSelfId(res.selfId);
            setState(res.state);
            applyPlayback(res.state.playback, true);
          } else {
            onLeave(); // the room expired while we were away
          }
        },
      );
    };
    socket.on('connect', rejoin);
    return () => { socket.off('connect', rejoin); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the screen awake while a YOUTUBE track plays (where supported). A
  // locked screen suspends the YouTube player — embeds aren't allowed to play
  // in the background — so staying visible is the only way to keep the music
  // going. Library tracks play through <audio> and survive a locked screen, so
  // they don't need (or want) the lock.
  useEffect(() => {
    if (!isPlaying || state.playback.kind === 'lib') return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        if (!('wakeLock' in navigator)) return;
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) { l.release().catch(() => {}); return; }
        lock = l;
      } catch { /* unsupported or denied — non-fatal */ }
    };
    void request();
    // The OS auto-releases the lock when the page hides; re-acquire on return.
    const onVis = () => { if (document.visibilityState === 'visible') void request(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [isPlaying, state.playback.kind]);

  // Coming back to the foreground: the browser suspended our player while we
  // were away. Snap to the room's current position and try to resume; if the
  // browser insists on a fresh tap, the tap-to-play overlay takes over.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (playbackRef.current.videoId) applyPlayback(playbackRef.current, true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continuous gentle re-sync: every few seconds re-align to where the room
  // should be (anchored playback position + server-clock offset). This keeps
  // members in sync even when host heartbeats are throttled or missed.
  useEffect(() => {
    const id = setInterval(() => {
      if (playbackRef.current.videoId) applyPlayback(playbackRef.current, false);
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  function playFromQueue(itemId: string) { socket.emit('queue:playNow', { itemId }); }
  // Previous: restart the track if we're past the first few seconds (standard
  // player behaviour), otherwise step back to the previously played song.
  function hostPrev() {
    const at = playerRef.current?.getCurrentTime() ?? 0;
    if (at > 3) { playerRef.current?.seekTo(0); socket.emit('playback:seek', { positionSec: 0 }); return; }
    socket.emit('playback:previous');
  }
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
  codeRef.current = state.code;
  myNameRef.current = myName;
  const hasVideo = !!state.playback.videoId;
  const isLib = state.playback.kind === 'lib';
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const npTitle = title || state.playback.title || (hasVideo ? 'Now playing' : 'Nothing playing');
  const cover = state.playback.videoId && !isLib ? `https://img.youtube.com/vi/${state.playback.videoId}/mqdefault.jpg` : null;

  return (
    <div className="room">
      <header className="room-head">
        <span className="brand-mini">
          {/* Always animating, like every other screen's logo — pausing it here
              only looked like a glitch. */}
          <EqBars className="logo-eq sm" />
          <span className="wordmark">Wavelength</span>
        </span>
        <div className="head-actions">
          <button className="ghost sm-btn invite-btn" onClick={copyLink}>
            {copied ? '✓ Copied' : <><LinkIcon /> Invite link</>}
          </button>
          <span className="me-chip" title={user ? `Signed in as ${user.displayName}` : 'Guest'}>
            <span className="avatar sm" style={{ background: avatarColor(myName) }}>{initials(myName)}</span>
            <span className="me-name">{myName}{user?.username ? <small> @{user.username}</small> : null}</span>
            <span className="me-role">{isHost ? 'host' : 'member'}</span>
          </span>
        </div>
        <div className="head-right">
          <span className="room-badge"><span className="rb-label">Room </span><b>{state.code}</b></span>
          <button className="ghost sm-btn leave-btn" onClick={onLeave} title="Leave the room"><LeaveIcon /> Leave</button>
        </div>
      </header>

      <div className="room-grid">
        <section className="stage">
          {hasVideo ? (
            <div className="player-shell">
              {isLib ? (
                <div className="stage-empty audio-stage">
                  <div>
                    <EqBars className={isPlaying ? 'logo-eq' : 'logo-eq idle'} style={{ margin: '0 auto 14px', height: 34, justifyContent: 'center' }} />
                    <p><b>{npTitle}</b></p>
                    <p className="muted">Playing from My Music — keeps playing with the screen off.</p>
                  </div>
                  <AudioPlayer
                    key={state.playback.videoId!}
                    trackId={state.playback.videoId!}
                    title={state.playback.title ?? 'My music'}
                    onReady={onPlayerReady}
                    onEnded={() => { if (isHostRef.current) hostNext(); }}
                    onStateChange={onPlayerStateChange}
                  />
                </div>
              ) : (
                <YouTubePlayer
                  videoId={state.playback.videoId}
                  onReady={onPlayerReady}
                  onEnded={() => { if (isHostRef.current) hostNext(); }}
                  onStateChange={onPlayerStateChange}
                />
              )}
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
                <EqBars className="logo-eq" style={{ margin: '0 auto 14px', height: 34, justifyContent: 'center' }} />
                <p><b>Queue up a track to get started</b></p>
                <p className="muted">Open <b>Up next</b> and paste a YouTube link — or upload your own music. It plays for everyone, in sync.</p>
                <button
                  className="primary"
                  style={{ marginTop: 6 }}
                  onClick={() => { setTab('queue'); sideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                >+ Add the first song</button>
              </div>
            </div>
          )}

          <div className="card panel np-card">
            {cover && <div className="cover-bg" style={{ backgroundImage: `url(${cover})` }} />}
            <div className="nowplaying">
              {cover ? <img className="artwork" src={cover} alt="" /> : <div className="artwork placeholder"><WaveIcon size={26} /></div>}
              <div className="np-meta grow">
                <div className="np-title">{npTitle}</div>
                <div className="np-status">
                  <EqBars className={isPlaying ? 'eq np-eq playing' : 'eq np-eq'} />
                  <span>
                    {isPlaying ? 'Playing' : hasVideo ? 'Paused' : 'Add a song to begin'}
                    {hasVideo && state.playback.addedBy ? <span className="np-by"> · added by {state.playback.addedBy}</span> : null}
                  </span>
                </div>
              </div>
              {/* Save sits at the end of the row (right-aligned), out of the
                  title/status stack where it read as clutter. */}
              {user && hasVideo && (
                <button
                  className={favIds.has(state.playback.videoId!) ? 'fav-btn on' : 'fav-btn'}
                  onClick={() => void toggleFavourite()}
                  title={favIds.has(state.playback.videoId!) ? 'Remove from favourites' : 'Save to favourites'}
                >
                  <HeartIcon filled={favIds.has(state.playback.videoId!)} size={15} />
                  {favIds.has(state.playback.videoId!) ? 'Saved' : 'Save'}
                </button>
              )}
            </div>

            <div className="progress" style={{ marginTop: 14 }}>
              <span className="time">{fmtTime(pos)}</span>
              <div className="track seekable" onClick={seek}><div className="fill" style={{ width: `${pct}%` }} /></div>
              <span className="time">{fmtTime(dur)}</span>
            </div>

            <div className="transport" style={{ marginTop: 14 }}>
              <button className="round-btn" onClick={hostPrev} title="Previous track"><PrevIcon /></button>
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

        <aside className="side" ref={sideRef}>
          <div className="card panel chat-panel">
            <div className="tabs">
              <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button>
              <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Queue · {state.queue.length}</button>
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
              <>
                <div className="composer">
                  <div className="tabs seg">
                    <button className={addMode === 'yt' ? 'active' : ''} onClick={() => setAddMode('yt')}>▶ YouTube</button>
                    <button className={addMode === 'lib' ? 'active' : ''} onClick={() => setAddMode('lib')}><WaveIcon size={14} /> My Music</button>
                  </div>
                  {addMode === 'yt' ? (
                    <div className="addbar">
                      <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addSong(); }}
                        placeholder="Paste a YouTube link…" />
                      <button className="primary" onClick={addSong}>Add</button>
                    </div>
                  ) : user ? (
                    <div className="lib-box">
                      {library.length === 0 && (
                        <div className="empty-hint">No songs yet — upload one below.<br />Your songs keep playing in the background, even with the screen off.</div>
                      )}
                      {library.length > 0 && (
                        <ul className="list lib-list">
                          {library.map((t) => {
                            const playing = state.playback.videoId === t.id;
                            const queued = state.queue.some((q) => q.videoId === t.id);
                            return (
                              <li key={t.id} className={playing || queued ? 'row' : 'row click'}
                                onClick={() => { if (!playing && !queued) addLibTrack(t); }}
                                title={playing ? 'Playing now' : queued ? 'Already in the queue' : 'Add to queue'}>
                                <span className="grow">{t.title}</span>
                                {playing ? <span className="chip lib-state">▶ Playing</span>
                                  : queued ? <span className="chip lib-state">✓ Queued</span>
                                  : <button className="vote" onClick={(e) => { e.stopPropagation(); addLibTrack(t); }} title="Add to queue">+ Queue</button>}
                                <button className="iconbtn" onClick={(e) => { e.stopPropagation(); void deleteTrack(t.id); }} title="Delete track">✕</button>
                              </li>
                            );
                          })}
                        </ul>
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
                    </div>
                  ) : (
                    <div className="empty-hint">Sign in to upload your own songs — they keep playing in the background, even with the screen off.</div>
                  )}
                </div>
                <ul className="list scroll">
                  {state.queue.length === 0 && <div className="empty-hint">Nothing queued yet — the next song you add starts playing right away.</div>}
                  {state.queue.map((q, i) => {
                    const voted = !!me?.seat && (q.voters ?? []).includes(me.seat);
                    return (
                      <li key={q.id} className="row queue-item click"
                        onClick={() => playFromQueue(q.id)} title="Play this song now">
                        <span className="idx">{i + 1}</span>
                        <span className="grow">{q.kind === 'lib' ? <span className="lib-mark"><WaveIcon size={12} /></span> : null}{q.title} <small>· {q.addedBy}</small></span>
                        {isHost && i > 0 && (
                          <button className="iconbtn tofront" onClick={(e) => { e.stopPropagation(); socket.emit('queue:playNext', { itemId: q.id }); }} title="Play next">⤒</button>
                        )}
                        <button className={voted ? 'vote voted' : 'vote'} onClick={(e) => { e.stopPropagation(); vote(q.id); }} title={voted ? 'Remove your upvote' : 'Upvote'}>▲ {q.votes}</button>
                        <button className="iconbtn" onClick={(e) => { e.stopPropagation(); socket.emit('queue:remove', { itemId: q.id }); }} title="Remove from queue">✕</button>
                      </li>
                    );
                  })}
                </ul>
              </>
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

        </aside>
      </div>
    </div>
  );
}
