import { useEffect, useRef, useState } from 'react';
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

export default function Room({ initialState, selfId }: { initialState: RoomState; selfId: string }) {
  const [state, setState] = useState<RoomState>(initialState);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const playerRef = useRef<YTPlayerHandle | null>(null);
  const playbackRef = useRef<PlaybackState>(initialState.playback);
  const offset = useClockOffset();
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  const isHost = state.hostId === selfId;
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

  // Host heartbeat: re-stamp position every 4s so late/ drifting clients converge.
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

  // Host-only handlers
  function hostPlay() { socket.emit('playback:play', { positionSec: playerRef.current?.getCurrentTime() ?? 0 }); }
  function hostPause() { socket.emit('playback:pause', { positionSec: playerRef.current?.getCurrentTime() ?? 0 }); }
  function hostNext() { socket.emit('queue:next'); }

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

  return (
    <div className="room">
      <header className="room-head">
        <h1>Wavelength</h1>
        <span className="code">Room <b>{state.code}</b></span>
        <span className="role">{isHost ? 'You are the host (DJ)' : 'Listening'}</span>
      </header>

      <div className="room-grid">
        <section className="stage">
          <YouTubePlayer
            videoId={state.playback.videoId}
            onReady={onPlayerReady}
            onEnded={() => { if (isHost) hostNext(); }}
            onStateChange={() => { /* server is source of truth; ignore local */ }}
          />
          {isHost && (
            <div className="controls">
              <button onClick={hostPlay}>Play</button>
              <button onClick={hostPause}>Pause</button>
              <button onClick={hostNext}>Skip ▶▶</button>
              {user && <button onClick={saveQueueAsPlaylist}>Save queue</button>}
              {user && playlists.length > 0 && (
                <select
                  onChange={(e) => { if (e.target.value) loadPlaylist(e.target.value); e.target.value = ''; }}
                  defaultValue=""
                >
                  <option value="" disabled>Load playlist…</option>
                  {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {user && onlineFriends.length > 0 && (
                <select
                  onChange={(e) => { if (e.target.value) inviteFriend(e.target.value); e.target.value = ''; }}
                  defaultValue=""
                >
                  <option value="" disabled>Invite a friend…</option>
                  {onlineFriends.map((f) => <option key={f.userId} value={f.userId}>@{f.username}</option>)}
                </select>
              )}
            </div>
          )}
          <div className="add-song">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste a YouTube link or 11-char id"
            />
            <button onClick={addSong}>Add to queue</button>
          </div>
        </section>

        <aside className="side">
          <div className="panel">
            <h3>Members ({state.members.length})</h3>
            <ul>{state.members.map((m) => (
              <li key={m.id}>{m.name}{m.id === state.hostId ? ' 🎧' : ''}{m.id === selfId ? ' (you)' : ''}</li>
            ))}</ul>
          </div>

          <div className="panel">
            <h3>Up next ({state.queue.length})</h3>
            <ol>{state.queue.map((q, i) => <li key={i}>{q.title} <small>— {q.addedBy}</small></li>)}</ol>
          </div>

          <div className="panel chat">
            <h3>Chat</h3>
            <div className="messages">
              {messages.map((m, i) => <div key={i}><b>{m.name}:</b> {m.text}</div>)}
            </div>
            <div className="chat-input">
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                placeholder="Say something…"
              />
              <button onClick={sendChat}>Send</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
