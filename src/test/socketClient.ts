/**
 * test/socketClient.ts — A minimal Socket.IO v4 client over Node's built-in
 * WebSocket, so tests and load scripts need no extra package.
 *
 * Protocol frames used: "0{…}" server hello, "40{auth}" connect to the default
 * namespace, "40{…}" connected, "44{…}" connection refused, "2"/"3" ping/pong,
 * "42[event,payload]" events.
 */

export interface SocketClient {
  /** Resolves once connected; rejects with the server's refusal message. */
  ready: Promise<void>;
  emit(event: string, payload: unknown): void;
  /** Every event received, in order. */
  received: { event: string; payload: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any -- payloads vary per event
  /** Resolves with the first received event that matches (including ones that already arrived), or rejects after `timeoutMs`. */
  waitFor(event: string, matches?: (payload: any) => boolean, timeoutMs?: number): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close(): void;
}

export function connectSocket(baseUrl: string, auth: { token: string; role: "customer" | "shopkeeper" }): SocketClient {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/socket.io/?EIO=4&transport=websocket`);
  const received: SocketClient["received"] = [];
  const listeners: (() => void)[] = [];

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => undefined); // callers that expect a refusal still observe it; no unhandled rejection

  ws.addEventListener("message", (message) => {
    const data = String(message.data);
    if (data.startsWith("0")) ws.send(`40${JSON.stringify(auth)}`);
    else if (data === "2") ws.send("3");
    else if (data.startsWith("40")) resolveReady();
    else if (data.startsWith("44")) rejectReady(new Error(JSON.parse(data.slice(2)).message ?? "refused"));
    else if (data.startsWith("42")) {
      const [event, payload] = JSON.parse(data.slice(2));
      received.push({ event, payload });
      listeners.forEach((notify) => notify());
    }
  });
  ws.addEventListener("error", () => rejectReady(new Error("websocket error")));
  ws.addEventListener("close", () => rejectReady(new Error("closed before connecting")));

  return {
    ready,
    received,
    emit: (event, payload) => ws.send(`42${JSON.stringify([event, payload])}`),
    waitFor(event, matches = () => true, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        let from = 0;
        const check = () => {
          for (; from < received.length; from += 1) {
            const item = received[from];
            if (item.event === event && matches(item.payload)) {
              cleanup();
              resolve(item.payload);
              return;
            }
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`timed out waiting for "${event}"`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(check), 1);
        };
        listeners.push(check);
        check();
      });
    },
    close: () => ws.close(),
  };
}
