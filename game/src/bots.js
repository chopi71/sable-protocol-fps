// The bots: three Warden teammates and four Jackals, each a low-poly figure built
// from boxes with a team colour. A bot thinks in states — advance along the
// waypoint graph, engage when it sees an enemy, plant (carrier only), defend a
// site, retreat when hurt — and shoots with a human-like reaction delay, burst
// fire and aim error that grows with distance, target speed and flinch. Sight
// checks are staggered so seven bots never raycast on the same step.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';
import { range, pick } from './rng.js';

const BOT_RADIUS = 0.35;
const BOT_HEIGHT = 1.7;
const WALK_SPEED = 3.1;
const REACT_MIN = 0.35;
const REACT_MAX = 0.85;

const WARDEN_NAMES = ['Vex', 'Marlowe', 'Iris'];
const JACKAL_NAMES = ['Rook', 'Havoc', 'Dagger', 'Grim'];

function buildFigure(team) {
  const group = new THREE.Group();
  const main = team === 'wardens' ? PALETTE.warden : PALETTE.jackal;
  const dark = team === 'wardens' ? PALETTE.wardenDark : PALETTE.jackalDark;
  const torsoMat = new THREE.MeshStandardMaterial({ color: main, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.9 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.5 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), torsoMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  group.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.3, 0.32), darkMat);
  vest.position.y = 1.12;
  group.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skinMat);
  head.position.y = 1.55;
  head.castShadow = true;
  group.add(head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), darkMat);
  helmet.position.y = 1.72;
  group.add(helmet);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), darkMat);
  legL.position.set(-0.14, 0.36, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), torsoMat);
  armL.position.set(-0.33, 1.1, 0.12);
  armL.rotation.x = -0.9;
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.33;
  group.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), gunMat);
  gun.position.set(0.1, 1.18, 0.42);
  group.add(gun);
  return { group, head, torso, legL, legR };
}

export function createBots(scene, map, rng, ctx) {
  const bots = [];
  const eye = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();

  function makeBot(team, name, spawn, weaponId, carrier) {
    const fig = buildFigure(team);
    scene.add(fig.group);
    const bot = {
      id: bots.length,
      name,
      team,
      weaponId,
      carrier: !!carrier,
      mesh: fig.group,
      headMesh: fig.head,
      legL: fig.legL,
      legR: fig.legR,
      pos: new THREE.Vector3(spawn[0], 0, spawn[1]),
      yaw: team === 'wardens' ? Math.PI : 0,
      hp: 100,
      alive: true,
      state: 'advance',
      path: [],
      pathIdx: 0,
      target: null,
      targetIsPlayer: false,
      reactT: 0,
      burstLeft: 0,
      fireT: 0,
      aimErr: 0.035,
      flinch: 0,
      scanT: rng() * 0.15,
      loseT: 0,
      plantT: 0,
      defuseT: 0,
      hold: { x: 0, z: 0 },
      walkPhase: rng() * 6,
      speed: WALK_SPEED,
    };
    fig.head.userData = { bot, part: 'head' };
    fig.torso.userData = { bot, part: 'body' };
    fig.group.traverse((child) => {
      if (child.isMesh && !child.userData.bot) child.userData = { bot, part: 'body' };
    });
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 3; i += 1) {
    makeBot('wardens', WARDEN_NAMES[i], map.spawns.wardens[i], 'rifle', false);
  }
  for (let i = 0; i < 4; i += 1) {
    makeBot('jackals', JACKAL_NAMES[i], map.spawns.jackals[i], i === 2 ? 'smg' : 'rifle', i === 0);
  }

  function collides(x, z) {
    for (const c of map.colliders) {
      if (c.max.y < 0.05 || c.min.y > BOT_HEIGHT) continue;
      if (x + BOT_RADIUS > c.min.x && x - BOT_RADIUS < c.max.x
        && z + BOT_RADIUS > c.min.z && z - BOT_RADIUS < c.max.z) return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, dt) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepLen = Math.min(dist, bot.speed * dt);
    const nx = bot.pos.x + (dx / dist) * stepLen;
    const nz = bot.pos.z + (dz / dist) * stepLen;
    const wantYaw = Math.atan2(dx, dz);
    let dy = wantYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += dy * Math.min(1, dt * 8);
    if (!collides(nx, bot.pos.z)) bot.pos.x = nx;
    if (!collides(bot.pos.x, nz)) bot.pos.z = nz;
    bot.walkPhase += dt * 9;
    return dist < 0.7;
  }

  function followPath(bot, dt) {
    if (bot.pathIdx >= bot.path.length) return true;
    const node = bot.path[bot.pathIdx];
    if (moveToward(bot, node.x, node.z, dt)) bot.pathIdx += 1;
    return bot.pathIdx >= bot.path.length;
  }

  function setPath(bot, tx, tz) {
    bot.path = map.findPath(bot.pos.x, bot.pos.z, tx, tz);
    bot.pathIdx = 0;
  }

  function chestOf(target, isPlayer) {
    if (isPlayer) return chest.set(ctx.player.state.position.x, ctx.player.state.position.y + 1.25, ctx.player.state.position.z);
    return chest.set(target.pos.x, target.pos.y + 1.25, target.pos.z);
  }

  function canSee(bot, target, isPlayer) {
    eye.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
    const to = chestOf(target, isPlayer);
    dir.copy(to).sub(eye);
    const dist = dir.length();
    if (dist > 42) return false;
    return ctx.combat.hasLOS(eye, to, dist);
  }

  function scan(bot) {
    // Nearest visible enemy wins; the player counts as one target.
    let best = null;
    let bestD = Infinity;
    let bestIsPlayer = false;
    if (ctx.player.state.alive) {
      const d = bot.pos.distanceTo(ctx.player.state.position);
      if (d < bestD && canSee(bot, ctx.player.state, true)) {
        best = ctx.player.state; bestD = d; bestIsPlayer = true;
      }
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const d = bot.pos.distanceTo(other.pos);
      if (d < bestD && canSee(bot, other, false)) {
        best = other; bestD = d; bestIsPlayer = false;
      }
    }
    if (best) {
      if (bot.target !== best) {
        bot.target = best;
        bot.targetIsPlayer = bestIsPlayer;
        bot.reactT = range(rng, REACT_MIN, REACT_MAX);
        bot.burstLeft = 0;
      }
      bot.loseT = 0;
      return true;
    }
    return false;
  }

  function fireAt(bot, dt) {
    bot.reactT -= dt;
    bot.fireT -= dt;
    if (bot.reactT > 0 || bot.burstLeft <= 0) {
      if (bot.burstLeft <= 0 && bot.fireT <= 0) {
        bot.burstLeft = 3 + Math.floor(rng() * 3);
        bot.fireT = range(rng, 0.45, 1.0);
      }
      return;
    }
    if (bot.fireT > 0) return;
    bot.fireT = 0.13;
    bot.burstLeft -= 1;
    const def = WEAPONS[bot.weaponId];
    const target = chestOf(bot.target, bot.targetIsPlayer);
    const dist = bot.pos.distanceTo(target);
    // Aim error: base error plus distance, target motion and flinch. A bot that
    // just took a hit, or one shooting at a sprinting target, sprays wide.
    const moving = bot.targetIsPlayer ? ctx.player.state.speed : 2.5;
    const err = bot.aimErr + dist * 0.0016 + moving * 0.004 + bot.flinch;
    dir.copy(target).sub(eye.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z)).normalize();
    dir.x += (rng() * 2 - 1) * err;
    dir.y += (rng() * 2 - 1) * err;
    dir.z += (rng() * 2 - 1) * err;
    dir.normalize();
    muzzle.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z)
      .addScaledVector(dir, 0.6);
    const hit = ctx.combat.shoot(muzzle, dir, 60, ctx.bots.hitMeshes(), true);
    if (hit) ctx.effects.tracer(muzzle, hit.point, def.tracer);
    if (hit && hit.bot && hit.bot !== bot) {
      const dmg = (hit.part === 'head' ? def.headDamage : def.damage) * 0.9;
      ctx.damageBot(hit.bot, dmg, bot.name, hit.part === 'head');
    } else if (hit && hit.isPlayer) {
      const dmg = (hit.part === 'head' ? def.headDamage : def.damage) * 0.65;
      ctx.damagePlayer(dmg, bot.name, hit.part === 'head');
    } else if (hit) {
      ctx.effects.sparksAt(hit.point, 4);
    }
    ctx.audio.playShot(def.sound, true);
    bot.flinch = Math.max(0, bot.flinch - 0.01);
  }

  function objectiveFor(bot) {
    const { match } = ctx;
    if (match.charge.state === 'planted') {
      // charge.site is the site object once planted; everyone converges on it.
      return { x: match.charge.site.x, z: match.charge.site.z, defend: bot.team === 'jackals' };
    }
    if (bot.team === 'jackals') {
      const site = match.charge.site === 'B' ? map.siteB : map.siteA;
      return { x: site.x, z: site.z, defend: false };
    }
    return bot.hold; // Wardens hold their lane until the charge is planted.
  }

  function stepBot(bot, dt) {
    if (!bot.alive) return;
    const { match } = ctx;
    // Buy phase is a freeze: nobody leaves the spawn until the round starts.
    if (match.phase === 'buy') return;
    bot.flinch = Math.max(0, bot.flinch - dt * 0.25);
    bot.scanT -= dt;
    if (bot.scanT <= 0) {
      bot.scanT = 0.15;
      const seen = scan(bot);
      if (seen && bot.state !== 'engage') {
        if (bot.state === 'plant') bot.plantT = 0; // planting is interrupted
        bot.state = 'engage';
      } else if (!seen && bot.state === 'engage') {
        bot.loseT += 0.15;
        if (bot.loseT > 2) { bot.state = 'advance'; bot.target = null; }
      }
    }

    if (bot.state === 'engage' && bot.target) {
      const alive = bot.targetIsPlayer ? ctx.player.state.alive : bot.target.alive;
      if (!alive) { bot.state = 'advance'; bot.target = null; return; }
      // Face the target and shoot; strafe a little so a duel is not static.
      const to = chestOf(bot.target, bot.targetIsPlayer);
      const wantYaw = Math.atan2(to.x - bot.pos.x, to.z - bot.pos.z);
      let dy = wantYaw - bot.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      bot.yaw += dy * Math.min(1, dt * 10);
      fireAt(bot, dt);
      return;
    }

    if (bot.state === 'plant') {
      // The carrier kneels at the site and plants: 3.5 s of beeping, then the
      // charge is live. Any damage or a visible enemy breaks the plant.
      bot.plantT += dt;
      if (Math.floor(bot.plantT * 2) !== Math.floor((bot.plantT - dt) * 2)) ctx.audio.playBeep();
      if (bot.plantT >= 3.5) ctx.plantCharge(bot);
      return;
    }

    if (bot.state === 'retreat') {
      if (followPath(bot, dt)) bot.state = 'defend';
      return;
    }

    // advance / defend: walk the objective, plant when the carrier arrives.
    const obj = objectiveFor(bot);
    if (bot.team === 'jackals' && bot.carrier && match.charge.state === 'carried') {
      const dSite = Math.hypot(obj.x - bot.pos.x, obj.z - bot.pos.z);
      if (dSite < 2.2) {
        bot.state = 'plant';
        bot.plantT = 0;
        return;
      }
    }
    if (bot.team === 'wardens' && match.charge.state === 'planted') {
      const dSite = Math.hypot(obj.x - bot.pos.x, obj.z - bot.pos.z);
      if (dSite < 2) {
        // A Warden bot at the planted charge defuses it, 5 s on the spot.
        bot.defuseT += dt;
        if (Math.floor(bot.defuseT * 2) !== Math.floor((bot.defuseT - dt) * 2)) ctx.audio.playBeep(true);
        if (bot.defuseT >= 5) ctx.defuseCharge(bot.name);
        return;
      }
      bot.defuseT = 0;
    }
    if (bot.state === 'defend') {
      // Hold ground, scanning; small idle shuffle so the pose is not frozen.
      bot.walkPhase += dt * 1.5;
      return;
    }
    if (bot.pathIdx >= bot.path.length) {
      const dObj = Math.hypot(obj.x - bot.pos.x, obj.z - bot.pos.z);
      if (dObj < 1.2) { bot.state = obj.defend ? 'defend' : 'advance'; return; }
      setPath(bot, obj.x, obj.z);
    }
    followPath(bot, dt);
  }

  function syncMesh(bot) {
    const m = bot.mesh;
    m.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    if (!bot.alive) {
      m.rotation.set(-Math.PI / 2 + 0.15, bot.yaw, 0);
      m.position.y = 0.32;
      return;
    }
    m.rotation.set(0, bot.yaw, 0);
    const swing = Math.sin(bot.walkPhase) * 0.45;
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
    if (bot.state === 'plant') {
      m.position.y = -0.35; // kneeling to plant
    }
  }

  function reset(round, random) {
    const holdSpots = [
      { x: 0, z: 4 }, { x: -12, z: -2 }, { x: 12, z: -2 },
    ];
    const site = pick(random, ['A', 'B']);
    ctx.match.charge.site = site;
    bots.forEach((bot, i) => {
      const spawn = bot.team === 'wardens' ? map.spawns.wardens[i % 4] : map.spawns.jackals[i % 4];
      bot.pos.set(spawn[0], 0, spawn[1]);
      bot.yaw = bot.team === 'wardens' ? Math.PI : 0;
      bot.hp = 100;
      bot.alive = true;
      bot.state = 'advance';
      bot.path = [];
      bot.pathIdx = 0;
      bot.target = null;
      bot.plantT = 0;
      bot.defuseT = 0;
      bot.flinch = 0;
      bot.hold = bot.team === 'wardens' ? holdSpots[i % 3] : { x: 0, z: 0 };
      // Jackals spread: carrier goes to the chosen site, the others split so
      // both sites look threatened at the start of the round.
      if (bot.team === 'jackals' && !bot.carrier) {
        bot.hold = { x: 0, z: 0 };
      }
      syncMesh(bot);
      bot.mesh.rotation.set(0, bot.yaw, 0);
    });
    void round;
  }

  function step(dt) {
    for (const bot of bots) stepBot(bot, dt);
    for (const bot of bots) syncMesh(bot);
  }

  function aliveCount(team) {
    let n = 0;
    for (const bot of bots) if (bot.alive && bot.team === team) n += 1;
    return n;
  }

  function hitMeshes() {
    const meshes = [];
    for (const bot of bots) {
      if (!bot.alive) continue;
      bot.mesh.traverse((child) => { if (child.isMesh) meshes.push(child); });
    }
    return meshes;
  }

  return { bots, reset, step, aliveCount, hitMeshes };
}
