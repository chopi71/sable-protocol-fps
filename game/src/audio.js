// Sound, synthesised only: every effect is an oscillator or filtered noise
// shaped by an envelope, so the game ships no audio files and makes no network
// request. The context is created lazily on the first user gesture; until then
// every call is a silent no-op, which also keeps the screenshot modes safe.
let ctx = null;
let noiseBuffer = null;

export function ensureAudio() {
  if (ctx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

function envelope(gain, peak, attack, decay) {
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
}

function burst({ type = 'noise', freq = 800, freqEnd = null, peak = 0.25, attack = 0.002, decay = 0.09, filterFreq = null, filterType = 'lowpass' }) {
  if (!ctx) return;
  const out = ctx.createGain();
  out.connect(ctx.destination);
  let source;
  if (type === 'noise') {
    source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
  } else {
    source = ctx.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(freq, ctx.currentTime);
    if (freqEnd !== null) source.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + attack + decay);
  }
  if (filterFreq !== null) {
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    source.connect(filter);
    filter.connect(out);
  } else {
    source.connect(out);
  }
  envelope(out, peak, attack, decay);
  source.start();
  source.stop(ctx.currentTime + attack + decay + 0.05);
}

export function playShot(kind, distant = false) {
  if (!ctx) return;
  const vol = distant ? 0.08 : 0.3;
  if (kind === 'pistol') burst({ freq: 1400, freqEnd: 300, peak: vol, decay: 0.07, filterFreq: 2600 });
  else if (kind === 'smg') burst({ freq: 1100, freqEnd: 260, peak: vol * 0.8, decay: 0.06, filterFreq: 2200 });
  else if (kind === 'rifle') burst({ freq: 900, freqEnd: 180, peak: vol, decay: 0.11, filterFreq: 1800 });
  else burst({ freq: 500, freqEnd: 90, peak: vol * 1.2, decay: 0.22, filterFreq: 1200 });
}

export function playHit() {
  burst({ type: 'sine', freq: 1900, freqEnd: 1400, peak: 0.12, decay: 0.05 });
}

export function playStep() {
  burst({ freq: 300, freqEnd: 120, peak: 0.05, decay: 0.05, filterFreq: 500 });
}

export function playBeep(high = false) {
  burst({ type: 'sine', freq: high ? 1560 : 1040, peak: 0.14, decay: 0.12 });
}

export function playPlant() {
  burst({ type: 'sine', freq: 880, freqEnd: 1320, peak: 0.16, decay: 0.3 });
}

export function playExplosion() {
  burst({ freq: 120, freqEnd: 40, peak: 0.5, decay: 0.6, filterFreq: 500 });
}

export function playStinger(win) {
  if (!ctx) return;
  const notes = win ? [523, 659, 784] : [392, 330, 262];
  notes.forEach((freq, i) => {
    setTimeout(() => burst({ type: 'triangle', freq, peak: 0.18, decay: 0.35 }), i * 130);
  });
}

export function playReload() {
  burst({ type: 'sine', freq: 700, freqEnd: 500, peak: 0.08, decay: 0.06 });
  setTimeout(() => burst({ type: 'sine', freq: 900, freqEnd: 600, peak: 0.08, decay: 0.06 }), 180);
}
