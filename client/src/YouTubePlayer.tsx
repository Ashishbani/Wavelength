import { useEffect, useRef } from 'react';
import { loadYouTubeApi } from './youtubeApi.js';

export type YTPlayerHandle = {
  play(): void;
  pause(): void;
  seekTo(sec: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getTitle(): string;
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

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        height: '390',
        width: '100%',
        videoId: videoId ?? undefined,
        playerVars: { autoplay: 0, controls: 1, rel: 0 },
        events: {
          onReady: () => {
            const p = playerRef.current!;
            onReady({
              play: () => p.playVideo(),
              pause: () => p.pauseVideo(),
              seekTo: (sec) => p.seekTo(sec, true),
              getCurrentTime: () => p.getCurrentTime(),
              getDuration: () => p.getDuration(),
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
            if (e.data === YT.PlayerState.PLAYING) onStateChange(true, p.getCurrentTime());
            if (e.data === YT.PlayerState.PAUSED) onStateChange(false, p.getCurrentTime());
          },
        },
      });
    });
    return () => { cancelled = true; playerRef.current?.destroy(); playerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="player-wrap"><div ref={hostRef} /></div>;
}
