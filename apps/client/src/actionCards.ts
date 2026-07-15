import type { ActionCardType } from "@risk3d/engine";

/** Presentation metadata for the six action cards (name, art, rules text). */
export interface ActionCardInfo {
  type: ActionCardType;
  name: string;
  image: string;
  /** One-line summary of when it can be played and what it does. */
  blurb: string;
}

const IMG = (slug: string) => `/assets/cards/${slug}-action-card.png`;

export const ACTION_CARD_INFO: Record<ActionCardType, ActionCardInfo> = {
  troopTransport: {
    type: "troopTransport",
    name: "Troop Transport",
    image: IMG("troop-transport"),
    blurb: "Fortify phase: move troops between any two of your territories, connected or not.",
  },
  airStrike: {
    type: "airStrike",
    name: "Air Strike",
    image: IMG("air-strike"),
    blurb: "Before an attack: wipe out 20% of the defending army. Countered by Anti-Aircraft.",
  },
  misinformation: {
    type: "misinformation",
    name: "Misinformation",
    image: IMG("misinformation"),
    blurb: "Reinforce phase: show a fake army count on one territory until an enemy attacks it.",
  },
  antiAircraft: {
    type: "antiAircraft",
    name: "Anti-Aircraft",
    image: IMG("anti-aircraft"),
    blurb: "Passive: automatically nullifies an Air Strike played against you.",
  },
  minefield: {
    type: "minefield",
    name: "Minefield",
    image: IMG("minefield"),
    blurb: "When you lose a territory: destroy 2 of the armies the attacker moves in (1 if they move <4).",
  },
  tacticalRetreat: {
    type: "tacticalRetreat",
    name: "Tactical Retreat",
    image: IMG("tactical-retreat"),
    blurb: "While defending: retreat all armies to an adjacent territory instead of losing them.",
  },
};

export const actionCardInfo = (type: ActionCardType): ActionCardInfo => ACTION_CARD_INFO[type];
