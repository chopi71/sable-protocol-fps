// Weapons: four guns plus a grenade, each with its own price, damage, fire rate,
// magazine, reload time and spread. The numbers are the economy: a rifle costs
// most of a round's win bonus, a sniper almost two, so the buy menu is a real
// decision and the free pistol stays honest.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 25, headDamage: 68,
    rpm: 320, mag: 12, reserve: 36, reload: 1.4, spread: 0.006, kick: 0.006,
    auto: false, sound: 'pistol', tracer: 0xffe9a8,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', price: 1500, damage: 20, headDamage: 55,
    rpm: 780, mag: 30, reserve: 90, reload: 2.0, spread: 0.012, kick: 0.005,
    auto: true, sound: 'smg', tracer: 0xffd27a,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Sable', price: 2700, damage: 34, headDamage: 102,
    rpm: 600, mag: 25, reserve: 75, reload: 2.4, spread: 0.008, kick: 0.009,
    auto: true, sound: 'rifle', tracer: 0xfff2c0,
  },
  sniper: {
    id: 'sniper', name: 'LW-50 Longshot', price: 4750, damage: 95, headDamage: 190,
    rpm: 48, mag: 5, reserve: 15, reload: 3.2, spread: 0.001, kick: 0.03,
    auto: false, sound: 'sniper', tracer: 0xcfe6ff,
  },
};
export const GRENADE = { price: 300, name: 'Frag charge', max: 2 };
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'sniper'];

// A loadout is one owned weapon plus grenades. Spread is computed per shot:
// base spread, wider while moving, tighter while crouched, and bloom that grows
// with every shot in a burst and decays when the trigger is released. Standing
// still and firing in short bursts is how you hit anything past mid range.
export function createLoadout() {
  return {
    weaponId: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    grenades: 0,
    owned: { pistol: true },
    reloading: false,
    reloadT: 0,
    bloom: 0,
    cooldown: 0,
    triggerHeld: false,
  };
}

export function weaponOf(loadout) {
  return WEAPONS[loadout.weaponId];
}

export function spreadOf(loadout, speed, crouching, moving) {
  const def = weaponOf(loadout);
  let spread = def.spread * (crouching ? 0.55 : 1);
  if (moving) spread += speed * 0.0016;
  return spread + loadout.bloom;
}

export function canFire(loadout) {
  const def = weaponOf(loadout);
  return !loadout.reloading && loadout.cooldown <= 0 && loadout.mag > 0 && def;
}

export function takeShot(loadout) {
  if (!canFire(loadout)) return false;
  const def = weaponOf(loadout);
  loadout.mag -= 1;
  loadout.cooldown = 60 / def.rpm;
  loadout.bloom = Math.min(0.05, loadout.bloom + def.spread * 0.9);
  return true;
}

export function startReload(loadout) {
  const def = weaponOf(loadout);
  if (loadout.reloading || loadout.mag === def.mag || loadout.reserve <= 0) return false;
  loadout.reloading = true;
  loadout.reloadT = def.reload;
  return true;
}

export function finishReload(loadout) {
  const def = weaponOf(loadout);
  const need = def.mag - loadout.mag;
  const take = Math.min(need, loadout.reserve);
  loadout.mag += take;
  loadout.reserve -= take;
  loadout.reloading = false;
}

export function buyWeapon(loadout, id, money) {
  const def = WEAPONS[id];
  if (!def || loadout.owned[id]) return { ok: false, money };
  if (money < def.price) return { ok: false, money };
  loadout.owned[id] = true;
  loadout.weaponId = id;
  loadout.mag = def.mag;
  loadout.reserve = def.reserve;
  loadout.reloading = false;
  return { ok: true, money: money - def.price };
}

export function buyGrenade(loadout, money) {
  if (loadout.grenades >= GRENADE.max || money < GRENADE.price) return { ok: false, money };
  loadout.grenades += 1;
  return { ok: true, money: money - GRENADE.price };
}

export function stepLoadout(loadout, dt) {
  if (loadout.cooldown > 0) loadout.cooldown -= dt;
  loadout.bloom = Math.max(0, loadout.bloom - dt * 0.045);
  if (loadout.reloading) {
    loadout.reloadT -= dt;
    if (loadout.reloadT <= 0) finishReload(loadout);
  }
}
