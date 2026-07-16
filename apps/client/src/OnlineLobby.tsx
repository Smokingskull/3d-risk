import { useEffect, useRef, useState } from "react";
import type { Difficulty } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import type { LobbyInfo } from "./net/protocol.js";
import { Button, Dialog, Field, Segmented } from "./ui/index.js";

const SEAT_OPTS = [
  { value: "open", label: "Open" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "joshua", label: "Joshua" },
];

/** Online lobby: create or join a room, configure seats, chat, and start. Once the
 *  owner starts, the server pushes the game and the app switches to the in-game view. */
export function OnlineLobby({ hs }: { hs: Hotseat }) {
  const conn = hs.conn;
  const [lobby, setLobby] = useState<LobbyInfo | null>(null);
  const [chat, setChat] = useState<{ from: string; text: string }[]>([]);
  const [err, setErr] = useState("");
  const [name, setName] = useState("Player");
  const [players, setPlayers] = useState(3);
  const [campaign, setCampaign] = useState(true);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conn) return;
    return conn.on((m) => {
      if (m.type === "lobby") setLobby(m.room);
      else if (m.type === "chat") setChat((c) => [...c, { from: m.from, text: m.text }]);
      else if (m.type === "error") setErr(m.reason);
    });
  }, [conn]);
  useEffect(() => chatEnd.current?.scrollIntoView(), [chat]);

  if (!conn) return null;
  const you = hs.yourSeat;
  const isOwner = !!lobby && lobby.owner === you;

  const send = () => {
    const t = msg.trim();
    if (t) {
      conn.chat(t);
      setMsg("");
    }
  };

  return (
    <Dialog title="Online game" cardClassName="online-lobby" onClose={hs.reset}>
      {err && <p className="hint warn">{err}</p>}

      {!lobby ? (
        <>
          <Field label="Your name">
            <input className="seat-name" value={name} maxLength={18} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Create a room" hint="Others join with the room code you'll be given.">
            <div className="lobby-row">
              <Segmented
                options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))}
                value={players}
                onChange={setPlayers}
                ariaLabel="Players"
              />
              <label className="lobby-check">
                <input type="checkbox" checked={campaign} onChange={(e) => setCampaign(e.target.checked)} /> Campaign
              </label>
              <Button onClick={() => conn.create(name, players, campaign, false)}>Create</Button>
            </div>
          </Field>
          <Field label="Join a room">
            <div className="lobby-row">
              <input
                className="seat-name"
                placeholder="CODE"
                value={code}
                maxLength={4}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <Button variant="quiet" onClick={() => conn.join(code.trim(), name)}>
                Join
              </Button>
            </div>
          </Field>
        </>
      ) : (
        <>
          <div className="field">
            <span>
              Room <strong className="lobby-code">{lobby.code}</strong> — you are {you}
            </span>
            <div className="lobby-seats">
              {lobby.seats.map((s) => (
                <div className="scenario-seat" key={s.id}>
                  <span className="seat-label">
                    {s.name}
                    {s.connected ? " ✓" : ""}
                    {s.id === lobby.owner ? " · owner" : ""}
                  </span>
                  {isOwner && s.id !== lobby.owner ? (
                    <Segmented
                      options={SEAT_OPTS}
                      value={s.kind === "cpu" ? s.difficulty ?? "medium" : "open"}
                      onChange={(v) => (v === "open" ? conn.setSeat(s.id, "human") : conn.setSeat(s.id, "cpu", v as Difficulty))}
                      ariaLabel={`${s.id} type`}
                    />
                  ) : (
                    <span className="seat-tag">{s.kind === "cpu" ? (s.difficulty === "joshua" ? "Joshua" : `CPU · ${s.difficulty}`) : "Human"}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Chat</span>
            <div className="lobby-chat">
              {chat.map((c, i) => (
                <div key={i}>
                  <strong>{c.from}:</strong> {c.text}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <div className="lobby-row">
              <input
                className="seat-name"
                placeholder="Say something…"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <Button variant="quiet" onClick={send}>
                Send
              </Button>
            </div>
          </div>

          {isOwner ? (
            <Button onClick={() => conn.start()}>Start game</Button>
          ) : (
            <p className="hint">Waiting for the owner to start…</p>
          )}
        </>
      )}
    </Dialog>
  );
}
