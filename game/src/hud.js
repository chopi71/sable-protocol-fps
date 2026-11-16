// The HUD: every DOM readout the player sees — health, ammo, money, timer,
// scores, objective, kill feed, hitmarker, damage vignette, buy menu, plant
// bar, banners and the overlays — plus a small canvas minimap drawn from the
// map's own colliders, so the map on screen can never disagree with the map
// the bullets use. All updates are plain text and style writes; nothing here
// allocates in the frame loop except the minimap's per-frame draw.
import { WEAPONS, WEAPON_ORDER, GRENADE } from './weapons.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const healthFill = el('health-fill');
  const healthNum = el('health-num');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const moneyEl = el('money');
  const grenadeEl = el('grenades');
  const timerEl = el('timer');
  const scoreEl = el('score-line');
  const objectiveEl = el('objective');
  const feedEl = el('feed');
  const bannerEl = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const vignette = el('vignette');
  const plantBar = el('plantbar');
  const plantLabel = el('plantbar-label');
  const plantFill = el('plantbar-fill');
  const buyEl = el('buy');
  const buyList = el('buy-list');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playBtn = el('play');
  const scoreboard = el('scoreboard');
  const minimap = el('minimap');
  const mapCtx = minimap.getContext('2d');

  let bannerTimer = 0;
  let playCallback = null;
  let hitTimer = 0;

  // --- Buy menu rows, built once from the weapon table.
  const buyRows = [];
  for (const id of WEAPON_ORDER) {
    const def = WEAPONS[id];
    const row = document.createElement('div');
    row.className = 'buy-row';
    row.innerHTML = `<span class="buy-key">${WEAPON_ORDER.indexOf(id) + 1}</span>`
      + `<span class="buy-name">${def.name}</span>`
      + `<span class="buy-stat">${def.damage} dmg · ${def.rpm} rpm · ${def.mag} rnd</span>`
      + `<span class="buy-price">$${def.price}</span>`;
    buyList.appendChild(row);
    buyRows.push({ id, row, priceEl: row.querySelector('.buy-price') });
  }
  const grenadeRow = document.createElement('div');
  grenadeRow.className = 'buy-row';
  grenadeRow.innerHTML = `<span class="buy-key">5</span><span class="buy-name">${GRENADE.name}</span>`
    + `<span class="buy-stat">Throw with G · blast radius</span><span class="buy-price">$${GRENADE.price}</span>`;
  buyList.appendChild(grenadeRow);

  function setHealth(hp) {
    healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
    healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    healthFill.classList.toggle('low', hp <= 30);
  }

  function setAmmo(mag, reserve, reloading, name) {
    ammoMag.textContent = String(mag);
    ammoReserve.textContent = `/ ${reserve}${reloading ? ' · reloading' : ''}`;
    weaponName.textContent = name;
    ammoMag.parentElement.classList.toggle('empty', mag === 0);
  }

  function setMoney(money, grenades) {
    moneyEl.textContent = `$${money}`;
    grenadeEl.textContent = `Frag ×${grenades}`;
  }

  function setTimer(seconds, phase) {
    const s = Math.max(0, Math.ceil(seconds));
    timerEl.textContent = `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`;
    timerEl.classList.toggle('buy', phase === 'buy');
  }

  function setScores(wardens, jackals, round) {
    scoreEl.innerHTML = `<b class="w">Wardens ${wardens}</b> · Round ${round} · <b class="j">Jackals ${jackals}</b>`;
  }

  function setObjective(text) {
    objectiveEl.textContent = text;
  }

  function showBanner(title, sub, holdMs) {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub || '';
    bannerEl.classList.remove('hidden');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.add('hidden'), holdMs || 2600);
  }

  function hideBanner() {
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerEl.classList.add('hidden');
  }

  function feed(text, cls) {
    const div = document.createElement('div');
    div.className = `feed-line ${cls || ''}`;
    div.textContent = text;
    feedEl.prepend(div);
    while (feedEl.children.length > 6) feedEl.removeChild(feedEl.lastChild);
  }

  function hitmarkerKill(kill) {
    hitmarker.classList.add('on');
    hitmarker.classList.toggle('kill', !!kill);
    if (hitTimer) clearTimeout(hitTimer);
    hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), 140);
  }

  function damageFlash() {
    vignette.classList.remove('flash');
    void vignette.offsetWidth; // restart the animation
    vignette.classList.add('flash');
  }

  function setCrosshair(spread) {
    // Spread in world radians maps to a pixel gap around the centre dot.
    const gap = Math.round(4 + spread * 2600);
    crosshair.style.setProperty('--gap', `${Math.min(26, gap)}px`);
  }

  function showBuy(money, owned, currentId) {
    for (const { id, row, priceEl } of buyRows) {
      const def = WEAPONS[id];
      row.classList.toggle('owned', !!owned[id]);
      row.classList.toggle('current', id === currentId);
      row.classList.toggle('cant', !owned[id] && money < def.price);
      priceEl.textContent = owned[id] ? 'OWNED' : `$${def.price}`;
    }
    grenadeRow.classList.toggle('cant', money < GRENADE.price);
    buyEl.classList.remove('hidden');
  }

  function hideBuy() {
    buyEl.classList.add('hidden');
  }

  function showPlant(label, frac) {
    plantLabel.textContent = label;
    plantFill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    plantBar.classList.remove('hidden');
  }

  function hidePlant() {
    plantBar.classList.add('hidden');
  }

  function showOverlay(kind, data) {
    scoreboard.classList.add('hidden');
    overlay.removeAttribute('hidden');
    if (kind === 'start') {
      overlayTitle.textContent = 'SABLE PROTOCOL';
      overlayCopy.textContent = 'Round-based tactical FPS. Plant the charge or stop the plant — first to 7 rounds takes the match. Click to play.';
      playBtn.textContent = 'Click to play';
    } else if (kind === 'paused') {
      overlayTitle.textContent = 'Paused';
      overlayCopy.textContent = 'Pointer released. Click to resume.';
      playBtn.textContent = 'Resume';
    } else if (kind === 'end' || kind === 'match') {
      overlayTitle.textContent = data.title;
      overlayCopy.textContent = data.copy;
      playBtn.textContent = kind === 'match' ? 'Play again' : 'Next round';
      scoreboard.classList.remove('hidden');
      const sb = data.scoreboard;
      scoreboard.innerHTML = `<div>Score — Wardens <b>${sb.wardens}</b> · Jackals <b>${sb.jackals}</b></div>`
        + `<div>Kills <b>${sb.kills}</b> · Deaths <b>${sb.deaths}</b> · Money <b>$${sb.money}</b></div>`
        + `<div>Round <b>${sb.round}</b> of 13 · First to 7</div>`;
    }
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
    overlay.setAttribute('hidden', '');
  }

  function onPlay(callback) {
    playCallback = callback;
  }
  playBtn.addEventListener('click', () => {
    if (playCallback) playCallback();
  });

  // Minimap: the yard at 160x120, walls from the colliders, sites, the charge
  // and every living fighter as a dot. North is up.
  function drawMinimap(map, playerState, bots, charge) {
    const W = minimap.width;
    const H = minimap.height;
    const sx = (x) => ((x + 24) / 48) * W;
    const sy = (z) => ((z + 18) / 36) * H;
    mapCtx.fillStyle = '#20262e';
    mapCtx.fillRect(0, 0, W, H);
    mapCtx.fillStyle = '#39424d';
    for (const c of map.colliders) {
      if (c.max.y > 3.5) continue; // tall outer walls read as the frame
      mapCtx.fillRect(sx(c.min.x), sy(c.min.z), Math.max(1, sx(c.max.x) - sx(c.min.x)), Math.max(1, sy(c.max.z) - sy(c.min.z)));
    }
    mapCtx.fillStyle = '#35c08a';
    mapCtx.fillRect(sx(map.siteA.x) - 5, sy(map.siteA.z) - 4, 10, 8);
    mapCtx.fillStyle = '#c05a35';
    mapCtx.fillRect(sx(map.siteB.x) - 5, sy(map.siteB.z) - 4, 10, 8);
    mapCtx.fillStyle = '#e9e6df';
    mapCtx.font = 'bold 9px sans-serif';
    mapCtx.fillText('A', sx(map.siteA.x) - 3, sy(map.siteA.z) + 3);
    mapCtx.fillText('B', sx(map.siteB.x) - 3, sy(map.siteB.z) + 3);
    if (charge.state === 'planted') {
      mapCtx.fillStyle = '#ff5040';
      const px = sx(charge.site.x);
      const py = sy(charge.site.z);
      mapCtx.beginPath();
      mapCtx.arc(px, py, 5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    for (const bot of bots) {
      if (!bot.alive) continue;
      mapCtx.fillStyle = bot.team === 'wardens' ? '#5aa2f0' : '#f0a830';
      mapCtx.beginPath();
      mapCtx.arc(sx(bot.pos.x), sy(bot.pos.z), 3, 0, Math.PI * 2);
      mapCtx.fill();
    }
    if (playerState.alive) {
      mapCtx.fillStyle = '#ffffff';
      mapCtx.beginPath();
      mapCtx.arc(sx(playerState.position.x), sy(playerState.position.z), 3.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
  }

  return {
    setHealth, setAmmo, setMoney, setTimer, setScores, setObjective,
    showBanner, hideBanner, feed, hitmarkerKill, damageFlash, setCrosshair,
    showBuy, hideBuy, showPlant, hidePlant, showOverlay, hideOverlay,
    onPlay, drawMinimap,
  };
}
