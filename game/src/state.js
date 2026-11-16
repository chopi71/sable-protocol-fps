// Match state lives in one place: every module reads and writes this object, so a
// round's phase, timer, scores, money and charge can never drift apart between
// the HUD, the bots and the round flow in main.js.
export const FIRST_TO = 7;
export const MAX_ROUNDS = 13;
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3.5;
export const FUSE_SECONDS = 40;
export const DEFUSE_SECONDS = 5;
export const KILL_MONEY = 300;
export const WIN_MONEY = 2700;
export const LOSS_MONEY = 1900;
export const START_MONEY = 800;

export function createMatch() {
  return {
    phase: 'buy', // 'buy' | 'live' | 'end'
    round: 1,
    wins: { wardens: 0, jackals: 0 },
    timer: BUY_SECONDS, // seconds left in the current phase
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    // The charge: carried by the Jackal carrier, planted at a site, or gone.
    charge: { state: 'carried', site: null, plantT: 0, fuseT: FUSE_SECONDS, defuseT: 0 },
    banner: '',
    bannerSub: '',
    winner: null, // 'wardens' | 'jackals' | null while the round runs
    matchOver: false,
    elapsed: 0,
    feed: [], // { text, cls } newest first, capped by the HUD
  };
}

// One line into the kill feed; the HUD renders the newest entries.
export function feed(match, text, cls) {
  match.feed.unshift({ text, cls: cls || '' });
  if (match.feed.length > 6) match.feed.length = 6;
}

export function scoreLine(match) {
  return `${match.wins.wardens} — ${match.wins.jackals}`;
}
