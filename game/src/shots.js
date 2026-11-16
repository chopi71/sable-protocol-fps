// Screenshot staging: ?shot=start|play|site|end with &seed=N builds a
// deterministic frame from the same round flow live play uses — no special
// render path, no fake scenery. start is the buy phase, play a mid-round
// firefight at site A, site a planted charge at B with a defuse under way, end
// the round-end scoreboard. The seeded generator makes a given seed stage the
// same scene every time.
import * as THREE from 'three';

const tmpPoint = new THREE.Vector3();

function aimAt(ctx, point) {
  const p = ctx.player.state;
  tmpPoint.copy(point).sub(p.position);
  tmpPoint.y -= p.eye;
  const len = tmpPoint.length() || 1;
  p.yaw = Math.atan2(-tmpPoint.x, -tmpPoint.z);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, tmpPoint.y / len)));
  ctx.syncCamera();
}

export function stageShot(name, ctx) {
  const { match, hud, player, bots, loadout, map } = ctx;
  hud.hideOverlay();
  hud.hideBuy();
  ctx.startRound(1);
  // startRound re-opens the buy menu and the round banner; only the buy-phase
  // shot keeps them — the other shots stage their own HUD state below.
  hud.hideBuy();
  hud.hideBanner();
  match.money = 1400;

  if (name === 'start') {
    // Buy phase: the player at the Warden spawn, looking up mid, the buy menu
    // open, teammates in formation behind.
    player.reset(0, 15, 0);
    aimAt(ctx, new THREE.Vector3(0, 1.6, 0));
    loadout.weaponId = 'pistol';
    loadout.mag = 12;
    loadout.reserve = 36;
    ctx.syncHud();
    hud.showBuy(match.money, loadout.owned, loadout.weaponId);
    hud.showBanner('ROUND 1 — BUY PHASE', 'Spend your $800, then the round starts', 60000);
    hud.setObjective('Buy up — the Jackals push from the warehouse');
    ctx.settle(10);
    return;
  }

  if (name === 'play') {
    // Mid-round firefight at site A: the player has pushed up the west lane
    // with a rifle, one Jackal is about to drop, another is firing back.
    match.phase = 'live';
    match.timer = 62;
    loadout.owned.rifle = true;
    loadout.weaponId = 'rifle';
    loadout.mag = 25;
    loadout.reserve = 75;
    player.reset(-8, 6, 0);
    const havoc = bots.bots[4];
    const rook = bots.bots[3];
    const iris = bots.bots[2];
    // Havoc stands clear of the west-lane crate, so the player's shot has a
    // clean lane to him; Rook holds the site approach where he can be seen.
    havoc.pos.set(-13.5, 0, -12);
    havoc.hp = 30;
    rook.pos.set(-11, 0, -9);
    iris.pos.set(-5, 0, 8);
    // Hold position for the frame: the bots scan and may open fire, but they
    // do not walk off, so the staged shot keeps its clean lane to Havoc.
    havoc.state = 'defend';
    rook.state = 'defend';
    ctx.syncHud();
    ctx.settle(25);
    // Aim at the chest, not the head: the torso is the forgiving target, and
    // one rifle round in the chest drops a 30-hp Jackal for the kill feed.
    aimAt(ctx, new THREE.Vector3(havoc.pos.x, havoc.pos.y + 1.1, havoc.pos.z));
    ctx.shootPlayer();
    // A return tracer streaks past the player from Rook's rifle.
    tmpPoint.set(rook.pos.x, rook.pos.y + 1.45, rook.pos.z);
    const near = new THREE.Vector3(player.state.position.x - 2.5, 1.4, player.state.position.z - 3);
    ctx.effects.tracer(tmpPoint, near, 0xffd27a);
    ctx.effects.sparksAt(new THREE.Vector3(-10.5, 1.2, 3.5), 6);
    hud.setObjective('Site A — clear the Jackals, hold the yard');
    ctx.settle(1);
    return;
  }

  if (name === 'site') {
    // The charge is planted at B and ticking: a Warden bot is on the defuse
    // while a Jackal defends, and the player arrives from mid.
    match.phase = 'live';
    match.timer = 45;
    match.charge.state = 'planted';
    match.charge.site = map.siteB;
    match.charge.fuseT = 31;
    loadout.owned.rifle = true;
    loadout.weaponId = 'rifle';
    loadout.mag = 12;
    loadout.reserve = 50;
    player.reset(13.5, -1.5, 0);
    const rook = bots.bots[3];
    const dagger = bots.bots[5];
    const iris = bots.bots[2];
    rook.pos.set(17.5, 0, -11.5);
    rook.hp = 0;
    rook.alive = false;
    rook.state = 'dead';
    dagger.pos.set(19.5, 0, -7);
    dagger.state = 'defend';
    iris.pos.set(16.2, 0, -9.2);
    iris.state = 'advance';
    iris.defuseT = 2.1;
    ctx.syncChargeMesh();
    ctx.syncHud();
    ctx.settle(20);
    // Aim past the east-lane crate at the defusing Warden and the charge.
    aimAt(ctx, new THREE.Vector3(16.5, 1.1, -9.5));
    hud.showBanner('CHARGE PLANTED — SITE B', 'Defuse it before the fuse runs out', 60000);
    hud.showPlant('DEFUSING — IRIS', 0.42);
    hud.setObjective('Charge planted at B — defuse or lose the round');
    ctx.feed('Rook planted the charge at B', 'bad');
    return;
  }

  // end: the round is over, Wardens took it by elimination, and the
  // scoreboard is up over a yard with two Jackals down.
  match.phase = 'end';
  match.wins.wardens = 1;
  match.kills = 3;
  match.deaths = 0;
  // Stand south of mid with a clear lane at the two Jackals down in the yard.
  player.reset(2, 6, 0);
  const havoc = bots.bots[4];
  const grim = bots.bots[6];
  havoc.pos.set(-8, 0, -4);
  havoc.hp = 0;
  havoc.alive = false;
  havoc.state = 'dead';
  grim.pos.set(-12, 0, -8);
  grim.hp = 0;
  grim.alive = false;
  grim.state = 'dead';
  ctx.syncHud();
  ctx.settle(10);
  aimAt(ctx, new THREE.Vector3(-10, 1.2, -6));
  hud.showOverlay('end', {
    title: 'WARDENS WIN THE ROUND',
    copy: 'Elimination — all Jackals down. First to 7 takes the match.',
    scoreboard: { wardens: 1, jackals: 0, kills: 3, deaths: 0, money: match.money, round: 1 },
  });
}
