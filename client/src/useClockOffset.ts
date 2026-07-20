import { useEffect, useState } from 'react';
import { estimateOffset } from '@wavelength/shared';
import socket from './socket.js';

/** Returns estimated (serverClock - localClock) in ms, refined over a few samples. */
export function useClockOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let best = { rtt: Infinity, offset: 0 };
    let stop = false;
    function sample(n: number) {
      if (stop || n <= 0) { setOffset(best.offset); return; }
      const t0 = Date.now();
      socket.emit('time:ping', { t0 }, ({ serverTime }) => {
        const t1 = Date.now();
        const rtt = t1 - t0;
        if (rtt < best.rtt) best = { rtt, offset: estimateOffset(t0, t1, serverTime) };
        setOffset(best.offset);
        sample(n - 1);
      });
    }
    sample(5);
    return () => { stop = true; };
  }, []);
  return offset;
}
