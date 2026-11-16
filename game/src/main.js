// SABLE PROTOCOL — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. Round flow, damage, buying and the charge all
// live here; the modules own their own jobs (map, player, bots, combat, HUD,
// audio, effects). ?shot=start|play|site|end with &seed=N stages a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import {
  createMatch, feed, FIRST_TO, MAX_ROUNDS, BUY_SECONDS, ROUND_SECONDS,
  PLANT_SECONDS, FUSE_SECONDS, DEFUSE_SECONDS, KILL_MONEY, WIN_MONEY,
  LOSS_MONEY, START_MONEY,
} from './state.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import {
  createLoadout, weaponOf, spreadOf, canFire, takeShot, startReload,
  buyWeapon, buyGrenade, stepLoadout,
} from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createEffects } from './viewmodel.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import * as audio from './audio.js';
import { stageShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 22, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

// Dusk light: a warm low sun with shadows, plus a cool sky fill.
const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x3a332a, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0b3, 1.7);
sun.position.set(18, 28, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -32;
sun.shadow.camera.right = 32;
sun.shadow.camera.top = 32;
sun.shadow.camera.bottom = -32;
sun.shadow.camera.far = 80;
scene.add(sun);

const map = createMap(scene);
const effects = createEffects(scene, camera);
const combat = createCombat(scene, map, effects);
const hud = createHud();
const match = createMatch();
const player = createPlayer(map.colliders, map.bounds);
const loadout = createLoadout();

// The charge: a small dark case with a red lamp. It rides on the carrier's
// back while carried, sits on the site while planted, and hides otherwise.
const chargeGroup = new THREE.Group();
const chargeCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.32, 0.34),
  new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.4 }),
);
chargeCase.castShadow = true;
chargeGroup.add(chargeCase);
const chargeLampMat = new THREE.MeshStandardMaterial({ color: 0xd84a3a, emissive: 0xd84a3a, emissiveIntensity: 0.8 });
const chargeLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), chargeLampMat);
chargeLamp.position.set(0, 0.2, 0);
chargeGroup.add(chargeLamp);
chargeGroup.visible = false;
scene.add(chargeGroup);

// The context every module shares: one object, so bots, combat and the shot
// stager all see the same match, player and helpers.
const ctx = {
  scene, camera, map, match, rng: random,
  player, loadout, combat, effects, hud, audio,
  damageBot, damagePlayer, plantCharge, defuseCharge,
  startRound, endRound, shootPlayer, syncCamera, syncHud, syncChargeMesh,
  settle, feed: (text, cls) => { feed(match, text, cls); hud.feed(text, cls); },
};
const bots = createBots(scene, map, random, ctx);
ctx.bots = bots;

const input = createInput(renderer.domElement, onLockChange);
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpV = new THREE.Vector3();

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let swayX = 0;
let swayY = 0;
let lastBeepAt = 0;
let overlayTimer = 0;

function syncCamera() {
  const p = player.state;
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}

function syncChargeMesh() {
  if (match.charge.state === 'carried') {
    const carrier = bots.bots.find((b) => b.carrier && b.alive);
    if (!carrier) { chargeGroup.visible = false; return; }
    chargeGroup.visible = true;
    chargeGroup.position.set(carrier.pos.x, carrier.pos.y + 1.35, carrier.pos.z);
    chargeGroup.rotation.y = carrier.yaw;
    chargeLampMat.emissiveIntensity = 0.6;
  } else if (match.charge.state === 'planted') {
    chargeGroup.visible = true;
    chargeGroup.position.set(match.charge.site.x, 0.25, match.charge.site.z);
    chargeGroup.rotation.y = 0;
    // The lamp blinks faster as the fuse runs down.
    const fast = match.charge.fuseT < 10 ? 12 : 5;
    chargeLampMat.emissiveIntensity = Math.sin(elapsed * fast) > 0 ? 2.2 : 0.15;
  } else {
    chargeGroup.visible = false;
  }
}

function syncHud() {
  const def = weaponOf(loadout);
  hud.setHealth(player.state.hp);
  hud.setAmmo(loadout.mag, loadout.reserve, loadout.reloading, def.name);
  hud.setMoney(match.money, loadout.grenades);
  hud.setScores(match.wins.wardens, match.wins.jackals, match.round);
  hud.setTimer(match.timer, match.phase);
}

function startRound(n) {
  match.round = n;
  match.phase = 'buy';
  match.timer = BUY_SECONDS;
  match.winner = null;
  match.charge = { state: 'carried', site: null, plantT: 0, fuseT: FUSE_SECONDS, defuseT: 0 };
  player.reset(map.spawns.wardens[1][0], map.spawns.wardens[1][1], 0);
  // Reserve ammo is topped up between rounds; the mag stays as it was.
  for (const id of Object.keys(loadout.owned)) {
    const def = weaponOf({ weaponId: id });
    if (id === loadout.weaponId) loadout.reserve = def.reserve;
  }
  loadout.reloading = false;
  loadout.bloom = 0;
  bots.reset(n, random);
  hud.hidePlant();
  hud.hideBanner();
  syncHud();
  hud.setObjective('Buy up — the Jackals push from the warehouse');
  hud.showBuy(match.money, loadout.owned, loadout.weaponId);
  hud.showBanner(`ROUND ${n}`, 'Buy phase — B opens the buy menu', 2600);
  syncCamera();
  syncChargeMesh();
}

function startLive() {
  match.phase = 'live';
  match.timer = ROUND_SECONDS;
  hud.hideBuy();
  hud.setObjective('Defend sites A and B — stop the plant');
  hud.showBanner(`ROUND ${match.round}`, 'Fight!', 1800);
  syncHud();
}

function checkRoundEnd() {
  if (match.phase !== 'live') return;
  const wardensAlive = (player.state.alive ? 1 : 0) + bots.aliveCount('wardens');
  const jackalsAlive = bots.aliveCount('jackals');
  if (jackalsAlive === 0) endRound('wardens', 'elimination');
  else if (wardensAlive === 0) endRound('jackals', 'elimination');
}

function endRound(winner, reason) {
  if (match.phase === 'end') return;
  match.phase = 'end';
  match.timer = 5.5;
  match.winner = winner;
  match.wins[winner] += 1;
  match.money += winner === 'wardens' ? WIN_MONEY : LOSS_MONEY;
  const w = winner === 'wardens';
  const title = w ? 'WARDENS WIN THE ROUND' : 'JACKALS WIN THE ROUND';
  const sub = reason === 'elimination'
    ? (w ? 'All Jackals eliminated' : 'Your team was wiped out')
    : reason === 'time'
      ? 'Time expired — the charge was never planted'
      : reason === 'detonation'
        ? `The charge detonated at site ${match.charge.site ? match.charge.site.label : ''}`
        : 'Charge defused with seconds to spare';
  hud.hidePlant();
  hud.hideBuy();
  hud.showBanner(title, sub, 5200);
  audio.playStinger(w);
  ctx.feed(`${title} — ${sub}`, w ? 'good' : 'bad');
  syncHud();
  const over = match.wins.wardens >= FIRST_TO || match.wins.jackals >= FIRST_TO
    || (match.round >= MAX_ROUNDS && match.wins.wardens !== match.wins.jackals);
  match.matchOver = over;
  if (document.pointerLockElement) document.exitPointerLock();
  overlayTimer = setTimeout(() => {
    if (match.phase !== 'end') return;
    if (match.matchOver) {
      const mw = match.wins.wardens > match.wins.jackals ? 'WARDENS' : 'JACKALS';
      hud.showOverlay('match', {
        title: `${mw} TAKE THE MATCH`,
        copy: `Final score Wardens ${match.wins.wardens} — Jackals ${match.wins.jackals}.`,
        scoreboard: { wardens: match.wins.wardens, jackals: match.wins.jackals, kills: match.kills, deaths: match.deaths, money: match.money, round: match.round },
      });
    } else {
      hud.showOverlay('end', {
        title,
        copy: sub,
        scoreboard: { wardens: match.wins.wardens, jackals: match.wins.jackals, kills: match.kills, deaths: match.deaths, money: match.money, round: match.round },
      });
    }
  }, 1600);
}

function plantCharge(bot) {
  if (match.charge.state !== 'carried') return;
  const site = Math.hypot(bot.pos.x - map.siteA.x, bot.pos.z - map.siteA.z)
    < Math.hypot(bot.pos.x - map.siteB.x, bot.pos.z - map.siteB.z) ? map.siteA : map.siteB;
  match.charge.state = 'planted';
  match.charge.site = site;
  match.charge.fuseT = FUSE_SECONDS;
  match.charge.defuseT = 0;
  audio.playPlant();
  hud.setObjective(`Charge planted at ${site.label} — defuse it!`);
  hud.showBanner('CHARGE PLANTED', `Site ${site.label} — 40 seconds on the fuse`, 3000);
  ctx.feed(`Charge planted at site ${site.label}`, 'bad');
  syncChargeMesh();
}

function defuseCharge(actor) {
  if (match.charge.state !== 'planted') return;
  match.charge.state = 'defused';
  ctx.feed(`${actor} defused the charge`, 'good');
  endRound('wardens', 'defused');
}

function damagePlayer(dmg, from, isHead) {
  if (!player.state.alive || match.phase === 'end') return;
  const died = player.damage(dmg);
  hud.setHealth(player.state.hp);
  hud.damageFlash();
  if (died) {
    match.deaths += 1;
    ctx.feed(`${from} eliminated You`, 'bad');
    if (document.pointerLockElement) document.exitPointerLock();
    checkRoundEnd();
  }
  void isHead;
}

function damageBot(bot, dmg, killer, isHead) {
  if (!bot.alive) return;
  bot.hp -= dmg;
  bot.flinch = 0.06; // a hit throws the bot's aim off for a beat
  if (killer === 'You') {
    hud.hitmarkerKill(false);
    audio.playHit();
  }
  if (bot.hp <= 0) {
    bot.hp = 0;
    bot.alive = false;
    bot.state = 'dead';
    ctx.feed(`${killer} eliminated ${bot.name}`, killer === 'You' ? 'good' : '');
    if (killer === 'You') {
      match.kills += 1;
      match.money += KILL_MONEY;
      hud.hitmarkerKill(true);
      hud.setMoney(match.money, loadout.grenades);
    }
    if (bot.carrier && match.charge.state === 'carried') {
      // The charge changes hands: the nearest living Jackal picks it up.
      bot.carrier = false;
      let next = null;
      let nextD = Infinity;
      for (const other of bots.bots) {
        if (other.team !== 'jackals' || !other.alive) continue;
        const d = other.pos.distanceTo(bot.pos);
        if (d < nextD) { nextD = d; next = other; }
      }
      if (next) {
        next.carrier = true;
        ctx.feed('The charge changed hands', '');
      }
    }
    checkRoundEnd();
  }
  void isHead;
}

// One player shot: spread from the accuracy model, hitscan against the world
// and the bots, tracer and muzzle flash, recoil, and the alert that a shot
// was fired. Semi-auto weapons fire on the press, not the hold.
function shootPlayer() {
  if (!player.state.alive || match.phase !== 'live') return;
  if (loadout.mag === 0) {
    startReload(loadout);
    audio.playReload();
    return;
  }
  if (!takeShot(loadout)) return;
  const def = weaponOf(loadout);
  const p = player.state;
  const moving = p.speed > 0.5;
  const spread = spreadOf(loadout, p.speed, p.crouching, moving);
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position).addScaledVector(direction, 0.7);
  muzzle.x += Math.cos(p.yaw) * 0.22;
  muzzle.y -= 0.16;
  const hit = combat.shoot(camera.position, direction, 80, bots.hitMeshes(), false);
  const end = hit ? hit.point : tmpV.copy(camera.position).addScaledVector(direction, 60);
  effects.tracer(muzzle, end, def.tracer);
  effects.muzzleFlash();
  audio.playShot(def.sound, false);
  player.recoil(def.kick, (random() * 2 - 1) * def.kick * 0.35);
  if (hit && hit.bot) {
    damageBot(hit.bot, hit.part === 'head' ? def.headDamage : def.damage, 'You', hit.part === 'head');
  } else if (hit) {
    effects.sparksAt(hit.point, 5);
  }
  hud.setAmmo(loadout.mag, loadout.reserve, loadout.reloading, def.name);
  syncCamera();
}

function handlePresses(pressed) {
  for (const code of pressed) {
    if (code === 'KeyB' && match.phase === 'buy') {
      if (document.getElementById('buy').classList.contains('hidden')) {
        hud.showBuy(match.money, loadout.owned, loadout.weaponId);
      } else hud.hideBuy();
    }
    if (match.phase === 'buy') {
      const buyIdx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
      if (buyIdx >= 0) {
        const id = ['pistol', 'smg', 'rifle', 'sniper'][buyIdx];
        const res = buyWeapon(loadout, id, match.money);
        if (res.ok) {
          match.money = res.money;
          syncHud();
          hud.showBuy(match.money, loadout.owned, loadout.weaponId);
          audio.playReload();
        }
      }
      if (code === 'Digit5') {
        const res = buyGrenade(loadout, match.money);
        if (res.ok) {
          match.money = res.money;
          syncHud();
          hud.showBuy(match.money, loadout.owned, loadout.weaponId);
        }
      }
    }
    if (code === 'KeyR') {
      if (startReload(loadout)) audio.playReload();
    }
    if (code === 'KeyG' && match.phase === 'live' && loadout.grenades > 0) {
      camera.getWorldDirection(direction);
      muzzle.copy(camera.position).addScaledVector(direction, 0.6);
      combat.throwGrenade(muzzle, direction);
      loadout.grenades -= 1;
      hud.setMoney(match.money, loadout.grenades);
    }
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (player.state.alive && match.phase !== 'end' && !match.matchOver) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.ensureAudio();
  if (match.matchOver) {
    Object.assign(match, createMatch());
    startRound(1);
    input.requestLock();
    return;
  }
  if (match.phase === 'end') {
    clearTimeout(overlayTimer);
    hud.hideOverlay();
    startRound(match.round + 1);
  }
  input.requestLock();
});

function step(dt) {
  elapsed += dt;
  match.elapsed = elapsed;

  if (match.phase === 'buy') {
    match.timer -= dt;
    if (match.timer <= 0) startLive();
  } else if (match.phase === 'live') {
    match.timer -= dt;
    if (match.charge.state === 'planted') {
      match.charge.fuseT -= dt;
      // The beeping quickens as the fuse runs down.
      const interval = match.charge.fuseT > 20 ? 1.0 : match.charge.fuseT > 10 ? 0.5 : 0.25;
      if (elapsed - lastBeepAt >= interval) {
        lastBeepAt = elapsed;
        audio.playBeep(match.charge.fuseT < 10);
      }
      if (match.charge.fuseT <= 0) {
        effects.sparksAt(new THREE.Vector3(match.charge.site.x, 1, match.charge.site.z), 30);
        match.charge.state = 'detonated';
        endRound('jackals', 'detonation');
      }
    }
    // Defusing: hold E within reach of the planted charge.
    if (match.charge.state === 'planted') {
      const p = player.state;
      const d = Math.hypot(p.position.x - match.charge.site.x, p.position.z - match.charge.site.z);
      if (p.alive && d < 2.2 && input.state.keys.has('KeyE')) {
        match.charge.defuseT += dt;
        hud.showPlant('DEFUSING', match.charge.defuseT / DEFUSE_SECONDS);
        if (match.charge.defuseT >= DEFUSE_SECONDS) defuseCharge('You');
      } else {
        match.charge.defuseT = Math.max(0, match.charge.defuseT - dt * 2);
        if (match.charge.state === 'planted') hud.hidePlant();
      }
    }
    if (match.timer <= 0 && match.charge.state !== 'planted' && match.phase === 'live') {
      endRound('wardens', 'time');
    }
  } else if (match.phase === 'end') {
    // The scoreboard overlay is up; the round advances when the player taps
    // "Next round" (or the match overlay when the match is over).
    match.timer -= dt;
  }

  player.step(dt, input.state.keys);
  stepLoadout(loadout, dt);
  bots.step(dt);
  combat.step(dt, ctx);
  combat.syncPlayerBox(player.state);
  effects.step(dt, swayX, swayY);
  swayX *= 0.9;
  swayY *= 0.9;
  syncChargeMesh();
}

function settle(steps) {
  // Staging runs before the first render, so no matrix has been updated yet:
  // flush the scene graph before the steps (bot sight checks raycast against
  // the world) and after them (the scripted shots raycast against the bots),
  // or every raycast would test meshes sitting at the origin.
  scene.updateMatrixWorld(true);
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  scene.updateMatrixWorld(true);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    swayX += look.x * 0.0004;
    swayY += look.y * 0.0004;
    handlePresses(input.takePresses());
    const firing = input.state.firing && (input.isLocked() || !!shot);
    const def = weaponOf(loadout);
    if (firing && match.phase === 'live') {
      if (def.auto || !prevFiring) shootPlayer();
    }
    prevFiring = firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
    hud.setCrosshair(spreadOf(loadout, player.state.speed, player.state.crouching, player.state.speed > 0.5));
    hud.drawMinimap(map, player.state, bots.bots, match.charge);
  }
  renderer.render(scene, camera);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    hud.drawMinimap(map, player.state, bots.bots, match.charge);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startRound(1);
syncCamera();
if (shot) {
  stageShot(shot, ctx);
  syncCamera();
  syncHud();
  paintTwiceThenReady();
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
