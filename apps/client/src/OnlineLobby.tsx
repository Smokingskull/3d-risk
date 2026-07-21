import { useEffect, useRef, useState } from "react";
import type { Difficulty } from "@risk3d/engine";
import type { Hotseat } from "./game/useHotseat.js";
import type { LobbyInfo } from "@risk3d/protocol";
import { seatColor } from "./players.js";
import { Button, Dialog, Field, Segmented } from "./ui/index.js";

const SEAT_OPTS = [
  { value: "open", label: "Open" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "joshua", label: "Joshua" },
];
const MODE_OPTS: { value: "join" | "create"; label: string }[] = [
  { value: "join", label: "Join" },
  { value: "create", label: "Create" },
];
const YES_NO = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
];

/** Online lobby: create or join a room, configure seats, chat, and start. Once the
 *  owner starts, the server pushes the game and the app switches to the in-game view. */
export function OnlineLobby({ hs }: { hs: Hotseat }) {
  const conn = hs.conn;
  const [lobby, setLobby] = useState<LobbyInfo | null>(null);
  const [chat, setChat] = useState<{ from: string; seat: string; text: string }[]>([]);
  const [err, setErr] = useState("");
  const [name, setName] = useState("Player");
  const [mode, setMode] = useState<"join" | "create">("create");
  const [players, setPlayers] = useState(3);
  const [campaign, setCampaign] = useState(true);
  const [actionCards, setActionCards] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conn) return;
    return conn.on((m) => {
      if (m.type === "lobby") setLobby(m.room);
      else if (m.type === "chat") setChat((c) => [...c, { from: m.from, seat: m.seat, text: m.text }]);
      else if (m.type === "error") setErr(m.reason);
    });
  }, [conn]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView();
  }, [chat]);

  if (!conn) return null;
  const you = hs.yourSeat;
  const isOwner = !!lobby && lobby.owner === you;
  // Owner gone (their seat is no longer connected) → the game is abandoned; the
  // remaining players are otherwise stranded with no way to start.
  const ownerLeft = !!lobby && !lobby.seats.find((s) => s.id === lobby.owner)?.connected;
  // An unfilled human seat (open, awaiting a player) blocks the owner from starting.
  const hasEmptyHumanSeat = !!lobby && lobby.seats.some((s) => s.kind === "human" && !s.connected);

  const send = () => {
    const t = msg.trim();
    if (t) {
      conn.chat(t);
      setMsg("");
    }
  };

  return (
    <Dialog
      title={lobby ? "Game lobby" : "Online game"}
      cardClassName="online-lobby"
      onClose={hs.reset}
      closeOnBackdrop={!lobby}
      showClose={!lobby}
    >
      {!lobby ? (
        <>
          <Field label="Your name">
            <input className="seat-name lobby-input" value={name} maxLength={18} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label="Mode">
            <Segmented
              options={MODE_OPTS}
              value={mode}
              onChange={(m) => {
                setErr("");
                setMode(m);
              }}
              ariaLabel="Create or join a game"
            />
          </Field>

          {mode === "join" ? (
            <>
              <Field
                label={
                  <span className="lobby-code-label">
                    Room code
                    {err && <span className="lobby-error">{err}</span>}
                  </span>
                }
                hint="Enter the 4-letter code the room's owner gave you."
              >
                <input
                  className="seat-name lobby-input"
                  placeholder="CODE"
                  value={code}
                  maxLength={4}
                  onChange={(e) => {
                    setErr("");
                    setCode(e.target.value.toUpperCase());
                  }}
                />
              </Field>
              <Button onClick={() => conn.join(code.trim(), name)}>Join game</Button>
            </>
          ) : (
            <>
              <Field
                label="Campaign cards"
                hint="Deal every player a secret objective — hold a country, seize a continent or assassinate a rival. First to complete theirs wins. No plays a standard last-general-standing game."
              >
                <Segmented options={YES_NO} value={campaign} onChange={setCampaign} ariaLabel="Campaign cards" />
              </Field>

              <Field label="Action cards" hint="Deal each player 2 secret one-shot special cards to manage.">
                <Segmented options={YES_NO} value={actionCards} onChange={setActionCards} ariaLabel="Action cards" />
              </Field>

              <Field label="Players">
                <Segmented
                  options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))}
                  value={players}
                  onChange={setPlayers}
                  ariaLabel="Number of players"
                />
              </Field>

              <Button onClick={() => conn.create(name, players, campaign, actionCards)}>Create game</Button>
            </>
          )}
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
                  {isOwner && s.id !== lobby.owner && !(s.kind === "human" && s.connected) ? (
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
                  <strong style={{ color: seatColor(c.seat) }}>{c.from}:</strong> {c.text}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <div className="lobby-row">
              <input
                className="seat-name lobby-msg"
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

          {!isOwner &&
            (ownerLeft ? (
              <p className="lobby-error lobby-abandoned">Game abandoned</p>
            ) : (
              <p className="hint">Waiting for the owner to start…</p>
            ))}

          <div className="lobby-buttons">
            {isOwner && (
              <Button onClick={() => conn.start()} disabled={hasEmptyHumanSeat}>
                Start game
              </Button>
            )}
            <Button variant="quiet" onClick={hs.reset}>
              Leave
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
