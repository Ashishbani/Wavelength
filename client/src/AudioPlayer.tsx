import { useEffect, useRef } from 'react';
import type { YTPlayerHandle } from './YouTubePlayer.js';
import { audioUrl } from './auth/api.js';

// YT.PlayerState-compatible codes, so Room's sync logic works unchanged.
const PLAYING = 1, PAUSED = 2, BUFFERING = 3;

type Props = {
  trackId: string;
  title: string;
  onReady: (h: YTPlayerHandle) => void;
  onEnded: () => void;
  onStateChange: (isPlaying: boolean, positionSec: number) => void;
};

/**
 * Plays an uploaded library track through a plain <audio> element. Unlike a
 * YouTube embed, browsers allow this to KEEP PLAYING with the screen off or the
 * app in the background, and the Media Session API puts controls on the lock
 * screen.
 */
export default function AudioPlayer({ trackId, title, onReady, onEnded, onStateChange }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    onReady({
      play: () => { void a.play().catch(() => { /* needs a user gesture */ }); },
      pause: () => a.pause(),
      seekTo: (sec) => { a.currentTime = sec; },
      getCurrentTime: () => a.currentTime,
      getDuration: () => (Number.isFinite(a.duration) ? a.duration : 0),
      getTitle: () => title,
      getState: () => (a.paused ? PAUSED : a.readyState < 3 ? BUFFERING : PLAYING),
      loadVideo: () => { /* track changes re-render this component via key/src */ },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  // Lock-screen / notification media controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Wavelength', album: 'Listening together' });
    const a = () => audioRef.current;
    navigator.mediaSession.setActionHandler('play', () => { void a()?.play().catch(() => {}); });
    navigator.mediaSession.setActionHandler('pause', () => a()?.pause());
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
    };
  }, [title, trackId]);

  return (
    <audio
      ref={audioRef}
      src={audioUrl(trackId)}
      preload="auto"
      onPlay={() => onStateChange(true, audioRef.current?.currentTime ?? 0)}
      onPause={() => {
        const el = audioRef.current;
        if (el && !el.ended) onStateChange(false, el.currentTime);
      }}
      onEnded={onEnded}
    />
  );
}
