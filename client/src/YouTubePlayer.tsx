import { useEffect, useRef } from 'react';
import { loadYouTubeApi } from './youtubeApi.js';

export type YTPlayerHandle = {
  play(): void;
  pause(): void;
  seekTo(sec: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getTitle(): string;
  getState(): number;
  loadVideo(id: string): void;
};

type Props = {
  videoId: string | null;
  onReady: (h: YTPlayerHandle) => void;
  onEnded: () => void;
  onStateChange: (isPlaying: boolean, positionSec: number) => void;
};

export default function YouTubePlayer({ videoId, onReady, onEnded, onStateChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
  // Ignore transient PAUSED events fired by the API right after a (re)load, so a
  // track switch is never mistaken for the DJ pausing.
  const suppressPausedUntil = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      suppressPausedUntil.current = Date.now() + 1500;
      playerRef.current = new YT.Player(hostRef.current, {
        height: '100%',
        width: '100%',
        videoId: videoId ?? undefined,
        playerVars: { autoplay: 0, controls: 1, rel: 0 },
        events: {
          onReady: () => {
            const p = playerRef.current!;
            readyRef.current = true;
            onReady({
              play: () => p.playVideo(),
              pause: () => p.pauseVideo(),
              seekTo: (sec) => p.seekTo(sec, true),
              getCurrentTime: () => p.getCurrentTime(),
              getDuration: () => p.getDuration(),
              getState: () => p.getPlayerState(),
              getTitle: () => {
                const data = (p as unknown as { getVideoData?: () => { title?: string } }).getVideoData?.();
                return data?.title ?? '';
              },
              loadVideo: (id) => p.loadVideoById(id),
            });
          },
          onStateChange: (e) => {
            const p = playerRef.current!;
            if (e.data === YT.PlayerState.ENDED) onEnded();
            else if (e.data === YT.PlayerState.PLAYING) onStateChange(true, p.getCurrentTime());
            else if (e.data === YT.PlayerState.PAUSED) {
              if (Date.now() < suppressPausedUntil.current) return;
              onStateChange(false, p.getCurrentTime());
            }
          },
        },
      });
    });
    return () => { cancelled = true; readyRef.current = false; playerRef.current?.destroy(); playerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the room advances to a new track, load it into the existing player.
  // (The initial video is loaded by the constructor above; this handles changes.)
  useEffect(() => {
    if (!readyRef.current || !playerRef.current || videoId == null) return;
    suppressPausedUntil.current = Date.now() + 1500;
    playerRef.current.loadVideoById(videoId);
  }, [videoId]);

  return <div className="player-wrap"><div ref={hostRef} /></div>;
}
