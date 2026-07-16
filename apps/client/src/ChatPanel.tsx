import { useEffect, useRef, useState } from "react";
import type { Hotseat } from "./game/useHotseat.js";
import { Icon } from "./Icon.js";
import { seatColor } from "./players.js";
import { Button } from "./ui/index.js";

/** In-game chat for online play — a collapsible panel wired to the server connection.
 *  While collapsed, an incoming message lights a green "unread" dot in the title bar;
 *  expanding clears it. The dot never shows while the panel is open. */
export function ChatPanel({ hs }: { hs: Hotseat }) {
  const conn = hs.conn;
  const [log, setLog] = useState<{ from: string; seat: string; text: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(true);
  const [unread, setUnread] = useState(false);
  const openRef = useRef(open); // so the message listener reads the live open state
  openRef.current = open;
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conn) return;
    return conn.on((m) => {
      if (m.type !== "chat") return;
      setLog((l) => [...l, { from: m.from, seat: m.seat, text: m.text }]);
      if (!openRef.current) setUnread(true); // arrived while collapsed → badge it
    });
  }, [conn]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView();
  }, [log, open]);

  if (!conn) return null;
  const send = () => {
    const t = msg.trim();
    if (t) {
      conn.chat(t);
      setMsg("");
    }
  };
  const toggle = () =>
    setOpen((o) => {
      if (!o) setUnread(false); // expanding clears the unread badge
      return !o;
    });

  return (
    <div className={`chat-panel${open ? "" : " collapsed"}`}>
      <div className="chat-header">
        <h2>
          Chat
          {!open && unread && <span className="chat-unread" aria-label="New messages" />}
        </h2>
        <button className="collapse" aria-label={open ? "Collapse chat" : "Expand chat"} onClick={toggle}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
        </button>
      </div>

      {open && (
        <div className="chat-body">
          <div className="chat-log">
            {log.length === 0 && <div className="hint">Chat with the other players…</div>}
            {log.map((c, i) => (
              <div key={i}>
                <strong style={{ color: seatColor(c.seat) }}>{c.from}:</strong> {c.text}
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
      )}
    </div>
  );
}
