// Combat: the shared hitscan resolver and the grenade. One raycaster is reused
// for every shot in the game — the player's, the bots' and the line-of-sight
// checks — so no raycaster is ever built in a hot loop. A shot walks the hits
// nearest-first and skips dead bodies, so a bullet never stops on a corpse.
// The player is hit-tested with explicit ray-versus-box math (no invisible
// meshes), and the player's own shots exclude that test, so nobody shoots
// themself. Grenades fly a ballistic arc, bounce once off the ground, then
// detonate with falloff damage and a flash.
import * as THREE from 'three';
import { playExplosion } from './audio.js';

const GRENADE_FUSE = 1.6;
const GRENADE_RADIUS = 5.5;
const GRENADE_MAX = 120;

export function createCombat(scene, map, effects) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 80;
  const origin = new THREE.Vector3();
  const dirV = new THREE.Vector3();
  const grenades = [];
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0 }),
  );
  scene.add(blast);
  let blastT = 0;

  // Player hit volumes, kept as plain boxes: body 0.7 wide, head slightly
  // proud of the body in front and back so a head-height ray meets the head
  // box first. Reused every shot; never allocated per frame.
  const bodyBox = new THREE.Box3();
  const headBox = new THREE.Box3();
  const ray = new THREE.Ray();
  const tmpPoint = new THREE.Vector3();

  function syncPlayerBox(playerState) {
    const p = playerState.position;
    bodyBox.min.set(p.x - 0.35, p.y, p.z - 0.35);
    bodyBox.max.set(p.x + 0.35, p.y + playerState.height, p.z + 0.35);
    const eyeTop = p.y + playerState.eye;
    headBox.min.set(p.x - 0.25, eyeTop - 0.25, p.z - 0.4);
    headBox.max.set(p.x + 0.25, eyeTop + 0.15, p.z + 0.4);
  }

  // Nearest hit among world surfaces, alive bots and (unless excluded) the
  // player. Returns { point, distance, bot?, part?, isPlayer? } or null.
  function shoot(from, direction, maxDist, hitMeshes, includePlayer) {
    origin.copy(from);
    dirV.copy(direction).normalize();
    raycaster.set(origin, dirV);
    raycaster.far = maxDist;
    const targets = map.shootables.concat(hitMeshes || []);
    const hits = raycaster.intersectObjects(targets, false);
    let best = null;
    for (const hit of hits) {
      const ud = hit.object.userData || {};
      if (ud.bot && !ud.bot.alive) continue; // bullets pass through the fallen
      best = {
        point: hit.point.clone(),
        distance: hit.distance,
        bot: ud.bot || null,
        part: ud.part || 'body',
        isPlayer: false,
      };
      break;
    }
    if (includePlayer) {
      ray.origin.copy(origin);
      ray.direction.copy(dirV);
      let playerHit = null;
      if (ray.intersectBox(headBox, tmpPoint)) {
        playerHit = { point: tmpPoint.clone(), distance: origin.distanceTo(tmpPoint), part: 'head', isPlayer: true };
      } else if (ray.intersectBox(bodyBox, tmpPoint)) {
        playerHit = { point: tmpPoint.clone(), distance: origin.distanceTo(tmpPoint), part: 'body', isPlayer: true };
      }
      if (playerHit && (!best || playerHit.distance < best.distance)) best = playerHit;
    }
    return best;
  }

  function hasLOS(from, to, dist) {
    dirV.copy(to).sub(from).normalize();
    raycaster.set(from, dirV);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(map.shootables, false);
    return hits.length === 0;
  }

  function throwGrenade(from, direction) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a5a3a, roughness: 0.6 }),
    );
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({
      mesh,
      vel: new THREE.Vector3(direction.x * 13, direction.y * 13 + 4.5, direction.z * 13),
      t: GRENADE_FUSE,
    });
  }

  function explode(g, ctx) {
    const p = g.mesh.position;
    scene.remove(g.mesh);
    blast.position.copy(p);
    blastT = 0.35;
    effects.sparksAt(p, 24);
    playExplosion();
    const apply = (pos, damageFn) => {
      const d = Math.hypot(pos.x - p.x, pos.y - p.y - 1, pos.z - p.z);
      if (d < GRENADE_RADIUS) {
        damageFn(Math.max(12, Math.round(GRENADE_MAX * (1 - d / GRENADE_RADIUS))));
      }
    };
    for (const bot of ctx.bots.bots) {
      if (!bot.alive) continue;
      apply(bot.pos, (dmg) => ctx.damageBot(bot, dmg, 'Frag charge', false));
    }
    if (ctx.player.state.alive) {
      apply(ctx.player.state.position, (dmg) => ctx.damagePlayer(dmg, 'Frag charge', false));
    }
  }

  function step(dt, ctx) {
    if (blastT > 0) {
      blastT -= dt;
      const k = 1 - blastT / 0.35;
      blast.scale.setScalar(1 + k * 5);
      blast.material.opacity = Math.max(0, 0.55 * (1 - k));
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.t -= dt;
      g.vel.y -= 16 * dt;
      const p = g.mesh.position;
      p.addScaledVector(g.vel, dt);
      if (p.y < 0.12) {
        p.y = 0.12;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.6;
        g.vel.z *= 0.6;
      }
      if (g.t <= 0) {
        explode(g, ctx);
        grenades.splice(i, 1);
      }
    }
  }

  return { shoot, hasLOS, throwGrenade, step, syncPlayerBox };
}
