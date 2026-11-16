// The map: "Sable Yard", an original two-site yard behind a warehouse.
// Wardens spawn in the south yard; Jackals spawn inside the warehouse to the
// north and push out through its two doors. Site A sits in the west yard, site B
// in the east yard, and a container lane — mid — cuts straight through the
// middle. Everything is built from boxes, so every visible wall is also a
// collider (AABB) and a surface bullets stop on. Waypoints form a small graph
// over the lanes; bots pathfind on it with breadth-first search.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 5;
const HALF_X = 24;
const HALF_Z = 18;

// Waypoint graph: id -> [x, z]. Edges are listed as pairs of ids.
const WAYPOINTS = [
  [0, 15], [-6, 13], [6, 13], // 0-2 south spawn yard
  [0, 9], [-8, 8], [8, 8], // 3-5 approach
  [-2, 3], [2, 3], [0, 0], // 6-8 mid
  [-10, 0], [10, 0], // 9-10 flanks
  [-14, -5], [14, -5], // 11-12 site approaches
  [-17, -10], [17, -10], // 13-14 sites A and B
  [-6, -12.5], [6, -12.5], // 15-16 warehouse doors
  [0, -15.5], // 17 warehouse interior
  [-13, -13], [13, -13], // 18-19 north corners
  [-19, 4], [19, 4], // 20-21 south corners
  [-8, -7], [8, -7], // 22-23 north mid
  [0, -5], // 24 mid north
];
const EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 3], [1, 4], [2, 5],
  [3, 6], [3, 7], [4, 6], [5, 7], [6, 8], [7, 8],
  [6, 9], [7, 10], [9, 11], [10, 12], [9, 20], [10, 21],
  [11, 13], [12, 14], [11, 22], [12, 23], [22, 24], [23, 24],
  [8, 24], [22, 15], [23, 16], [15, 17], [16, 17],
  [15, 18], [16, 19], [18, 13], [19, 14], [20, 4], [21, 5],
  [13, 18], [14, 19], [9, 22], [10, 23],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    if (typeof PALETTE[name] !== 'number') continue;
    materials[name] = new THREE.MeshStandardMaterial({
      color: PALETTE[name], roughness: 0.92, metalness: 0.04,
    });
  }
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground slab and the yard's outer walls.
  box(HALF_X * 2 + 1, 0.4, HALF_Z * 2 + 1, 0, -0.4, 0, 'groundDark');
  box(0.6, WALL_H, HALF_Z * 2 + 1, -HALF_X - 0.3, 0, 0, 'wall');
  box(0.6, WALL_H, HALF_Z * 2 + 1, HALF_X + 0.3, 0, 0, 'wall');
  box(HALF_X * 2 + 1, WALL_H, 0.6, 0, 0, -HALF_Z - 0.3, 'wallDark');
  box(HALF_X * 2 + 1, WALL_H, 0.6, 0, 0, HALF_Z + 0.3, 'wallDark');

  // The warehouse along the north wall, with two door gaps at x = -6 and x = +6.
  // Jackals spawn inside it; Wardens never see its interior until a door opens.
  box(3.2, 6, 5, -8.4, 0, -15.5, 'wallDark');
  box(10.4, 6, 5, 0, 0, -15.5, 'wall');
  box(3.2, 6, 5, 8.4, 0, -15.5, 'wallDark');
  box(4.4, 1.4, 5, -6, 4.6, -15.5, 'wallDark'); // lintels over the doors
  box(4.4, 1.4, 5, 6, 4.6, -15.5, 'wallDark');
  box(12, 0.3, 6, 0, 6, -15.5, 'metal', false); // roof lip, no collision

  // Mid lane: two rust containers form the choke, crates break the sightline.
  box(6, 2.6, 2.6, -4.5, 0, 1.5, 'container');
  box(6, 2.6, 2.6, 4.5, 0, -2.5, 'containerB');
  box(6, 2.6, 2.6, 4.5, 2.6, -2.5, 'container', false);
  box(1.4, 1.4, 1.4, 0, 0, 6.5, 'crate');
  box(1.4, 1.4, 1.4, -1.6, 0, -4.5, 'crateDark');
  box(1.2, 1.2, 1.2, 3, 0, 5.5, 'crate');

  // West yard around site A, east yard around site B: crates to crouch behind,
  // a tall container each side to cut the long cross-map angle.
  box(1.6, 1.6, 1.6, -14.5, 0, -8, 'crate');
  box(1.6, 1.6, 1.6, -19.5, 0, -12.5, 'crateDark');
  box(1.2, 1.2, 1.2, -15, 0, -12.8, 'crate');
  box(6, 2.6, 2.6, -20.5, 0, -4, 'containerB');
  box(1.6, 1.6, 1.6, 14.5, 0, -8, 'crate');
  box(1.6, 1.6, 1.6, 19.5, 0, -12.5, 'crateDark');
  box(1.2, 1.2, 1.2, 15, 0, -12.8, 'crate');
  box(6, 2.6, 2.6, 20.5, 0, -4, 'container');

  // South yard: low walls that split the spawn push into three lanes.
  box(0.5, 1.3, 6, -12, 0, 7, 'wall');
  box(0.5, 1.3, 6, 12, 0, 7, 'wall');
  box(1.4, 1.4, 1.4, -8, 0, 12, 'crate');
  box(1.4, 1.4, 1.4, 8, 0, 12, 'crateDark');
  box(1.2, 1.2, 1.2, -19, 0, 10, 'crate');
  box(1.2, 1.2, 1.2, 19, 0, 10, 'crate');

  // Site markers: flat painted pads plus a beacon pole, so each site reads at
  // a glance from across the yard. Pads do not collide.
  function siteMarker(x, z, colorName, label) {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.08, 5),
      new THREE.MeshStandardMaterial({ color: PALETTE[colorName], roughness: 0.7 }),
    );
    pad.position.set(x, 0.05, z);
    pad.receiveShadow = true;
    group.add(pad);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8),
      materials.metal,
    );
    pole.position.set(x + 2.2, 1.7, z + 2.2);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: PALETTE[colorName], emissive: PALETTE[colorName], emissiveIntensity: 1.4 }),
    );
    lamp.position.set(x + 2.2, 3.5, z + 2.2);
    group.add(lamp);
    return { x, z, label };
  }
  const siteA = siteMarker(-17, -10, 'siteA', 'A');
  const siteB = siteMarker(17, -10, 'siteB', 'B');

  // Breadth-first search over the waypoint graph. Returns waypoint ids from
  // the nearest node to `from` to the nearest node to `to`.
  const adjacency = WAYPOINTS.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const dx = WAYPOINTS[i][0] - x;
      const dz = WAYPOINTS[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    const prev = new Array(WAYPOINTS.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === goal) break;
      for (const next of adjacency[node]) {
        if (prev[next] === -1) { prev[next] = node; queue.push(next); }
      }
    }
    const ids = [];
    let node = goal;
    while (node !== start && node !== -1) { ids.unshift(node); node = prev[node]; }
    return ids.map((id) => ({ x: WAYPOINTS[id][0], z: WAYPOINTS[id][1] }));
  }

  return {
    colliders,
    shootables,
    siteA,
    siteB,
    bounds: { minX: -HALF_X, maxX: HALF_X, minZ: -HALF_Z, maxZ: HALF_Z },
    spawns: {
      wardens: [[-4, 15], [0, 15.5], [4, 15], [-1.5, 13.5]],
      jackals: [[-3, -15.5], [0, -15.5], [3, -15.5], [-1.5, -14]],
    },
    findPath,
    waypoints: WAYPOINTS,
  };
}
