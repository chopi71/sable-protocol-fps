// The player: first-person movement with acceleration and friction, crouching,
// jumping and gravity, resolved as a capsule (a circle in the ground plane)
// against the map's AABB colliders one axis at a time, so a wall never swallows
// the player and sliding along a wall feels right. No per-frame allocations:
// the probe box and the wish vector are reused.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.4;

export function createPlayer(colliders, bounds) {
  const player = {
    position: new THREE.Vector3(0, 0, 15),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    hp: 100,
    alive: true,
    speed: 0, // horizontal speed, for the spread model and the HUD
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!player.alive) return;
    const crouchKey = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouchKey && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouchKey && player.crouching
      && !overlaps(player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 14);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
    if (wish.lengthSq() > 0) wish.normalize();
    const maxSpeed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const accel = player.onGround ? GROUND_ACCEL : AIR_ACCEL;
    player.velocity.x += wish.x * accel * dt;
    player.velocity.z += wish.z * accel * dt;
    if (player.onGround) {
      const drop = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= drop;
      player.velocity.z *= drop;
    }
    const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    if (hSpeed > maxSpeed) {
      player.velocity.x *= maxSpeed / hSpeed;
      player.velocity.z *= maxSpeed / hSpeed;
    }
    player.speed = Math.hypot(player.velocity.x, player.velocity.z);

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.velocity.y -= GRAVITY * dt;

    // Move one axis at a time; a blocked axis stops without killing the other.
    const p = player.position;
    let nx = p.x + player.velocity.x * dt;
    if (!overlaps(nx, p.y, p.z, player.height, 0.02)) p.x = nx;
    else player.velocity.x = 0;
    let nz = p.z + player.velocity.z * dt;
    if (!overlaps(p.x, p.y, nz, player.height, 0.02)) p.z = nz;
    else player.velocity.z = 0;
    p.x = Math.max(bounds.minX + RADIUS, Math.min(bounds.maxX - RADIUS, p.x));
    p.z = Math.max(bounds.minZ + RADIUS, Math.min(bounds.maxZ - RADIUS, p.z));
    p.y += player.velocity.y * dt;
    if (p.y <= 0) {
      p.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
  }

  function damage(amount) {
    if (!player.alive) return false;
    player.hp -= amount;
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      return true;
    }
    return false;
  }

  function reset(x, z, yaw) {
    player.position.set(x, 0, z);
    player.velocity.set(0, 0, 0);
    player.yaw = yaw;
    player.pitch = 0;
    player.hp = 100;
    player.alive = true;
    player.crouching = false;
    player.height = STAND_HEIGHT;
    player.eye = STAND_EYE;
  }

  return { state: player, look, recoil, step, damage, reset };
}
