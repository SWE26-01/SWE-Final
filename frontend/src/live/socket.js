// A WebSocket that reconnects by itself: 1s, 2s, 4s … up to 10s between tries.
// The services send a fresh `snapshot` after every (re)connect, so callers just replace their state.

export function openSocket(url, { onMessage, onStatus }) {
  let socket = null;
  let timer = null;
  let delay = 1000;
  let stopped = false;

  const connect = () => {
    onStatus('connecting');
    socket = new WebSocket(url);
    socket.onopen = () => {
      delay = 1000;
      onStatus('open');
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        // ignore a malformed message; the next snapshot will resync
      }
    };
    socket.onclose = () => {
      if (stopped) return;
      onStatus('closed');
      timer = window.setTimeout(connect, delay);
      delay = Math.min(delay * 2, 10000);
    };
    socket.onerror = () => socket.close();
  };

  connect();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    if (socket) socket.close();
  };
}
