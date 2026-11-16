// The weapon viewmodel and the transient combat effects: muzzle flash, tracer
// lines and hit sparks. All three effect pools are fixed-size and reused, so a
// firefight allocates nothing per frame. The viewmodel is a low-poly gun built
// from boxes, attached to the camera, with sway from mouse movement and a kick
// that decays after every shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_MAX = 24;
const SPARK_MAX = 40;

export function createEffects(scene, camera) {
  // --- Viewmodel: receiver, barrel, grip, magazine, sight. One group, parented
  // to the camera, so it inherits the player's look exactly.
  const gun = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: PALETTE.crateDark, roughness: 0.85 });
  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    gun.add(mesh);
    return mesh;
  }
  part(0.09, 0.11, 0.42, 0, 0, 0, metal); // receiver
  part(0.05, 0.05, 0.34, 0, 0.02, -0.36, dark); // barrel
  part(0.07, 0.16, 0.09, 0, -0.12, 0.06, wood); // grip
  part(0.06, 0.16, 0.1, 0, -0.13, -0.1, dark); // magazine
  part(0.02, 0.05, 0.06, 0, 0.08, -0.05, dark); // sight
  gun.position.set(0.26, -0.24, -0.45);
  camera.add(gun);

  // Muzzle flash: a small emissive quad plus a point light, shown for one frame
  // after a shot and hidden again.
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  flash.position.set(0.26, -0.22, -0.85);
  camera.add(flash);
  const flashLight = new THREE.PointLight(0xffc46a, 0, 9, 1.6);
  flashLight.position.set(0.26, -0.2, -0.9);
  camera.add(flashLight);

  // --- Tracers: pre-built line segments, each with its own fade timer.
  const tracers = [];
  for (let i = 0; i < TRACER_MAX; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;

  // --- Sparks: pre-built points, one buffer, each spark with a velocity.
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARK_MAX * 3);
  const sparkVel = new Float32Array(SPARK_MAX * 3);
  const sparkLife = new Float32Array(SPARK_MAX);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffc46a, size: 0.09, transparent: true, opacity: 0.95, sizeAttenuation: true,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkIdx = 0;

  const tmp = new THREE.Vector3();

  function muzzleFlash() {
    flashMat.opacity = 0.95;
    flash.rotation.z = Math.random() * Math.PI;
    flashLight.intensity = 14;
    gun.position.z = -0.45 + 0.06; // kick back
  }

  function tracer(from, to, color) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % TRACER_MAX;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
    pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color || 0xffe9a8);
    t.line.material.opacity = 0.9;
    t.life = 0.09;
  }

  function sparksAt(point, count) {
    for (let n = 0; n < count; n += 1) {
      const i = sparkIdx;
      sparkIdx = (sparkIdx + 1) % SPARK_MAX;
      sparkPos[i * 3] = point.x;
      sparkPos[i * 3 + 1] = point.y;
      sparkPos[i * 3 + 2] = point.z;
      sparkVel[i * 3] = (Math.random() - 0.5) * 4;
      sparkVel[i * 3 + 1] = Math.random() * 3;
      sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 4;
      sparkLife[i] = 0.35;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  function step(dt, swayX, swayY) {
    // Viewmodel sway follows the look, recoil decays back to rest.
    gun.position.x = 0.26 + swayX * 0.02;
    gun.position.y = -0.24 + swayY * 0.015;
    gun.position.z += (-0.45 - gun.position.z) * Math.min(1, dt * 12);
    if (flashMat.opacity > 0) {
      flashMat.opacity = Math.max(0, flashMat.opacity - dt * 14);
      flashLight.intensity = Math.max(0, flashLight.intensity - dt * 160);
    }
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.material.opacity = 0;
      }
    }
    let anySpark = false;
    for (let i = 0; i < SPARK_MAX; i += 1) {
      if (sparkLife[i] > 0) {
        sparkLife[i] -= dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        sparkVel[i * 3 + 1] -= 9 * dt;
        anySpark = true;
      }
    }
    if (anySpark) sparkGeo.attributes.position.needsUpdate = true;
    void tmp;
  }

  return { muzzleFlash, tracer, sparksAt, step };
}
