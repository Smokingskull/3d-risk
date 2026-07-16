import { useEffect, useRef, useState } from "react";
import type { Hotseat } from "./game/useHotseat.js";
import { Button } from "./ui/index.js";

/** In-game chat for online play — a small fixed panel wired to the server connection. */
export function ChatPanel({ hs }: { hs: Hotseat }) {
  const conn = hs.conn;
  const [log, setLog] = useState<{ from: string; text: string }[]>([]);
  const [msg, setMsg] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conn) return;
    return conn.on((m) => {
      if (m.type === "chat") setLog((l) => [...l, { from: m.from, text: m.text }]);
    });
  }, [conn]);
  useEffect(() => end.current?.scrollIntoView(), [log]);

  if (!conn) return null;
  const send = () => {
    const t = msg.trim();
    if (t) {
      conn.chat(t);
      setMsg("");
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-log">
        {log.length === 0 && <div className="hint">Chat with the other players…</div>}
        {log.map((c, i) => (
          <div key={i}>
            <strong>{c.from}:</strong> {c.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="chat-row">
        <input
          value={msg}
          maxLength={300}
          placeholder="Say something…"
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <Button variant="quiet" onClick={send}>
          Send
        </Button>
      </div>
    </div>
  );
}
