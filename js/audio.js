/* =========================================================
   Audio: menu music + SFX through a master/sound/music bus
   driven by KS.Settings.
   - Music loops everywhere; full restart only when leaving a
     run for menu / character select (NOT on run restart).
   - popclick on click; lower blip on hover (debounced).
   - punch1-3.mp3: one is picked at random per fist attack.
   - material pickup blip (alternate pitch when the
     "Change material sounds" setting is on).
   - Mute on losing focus (setting) mutes the whole bus.
   ========================================================= */
window.KS = window.KS || {};

KS.Audio = (() => {
  const PUNCHES = ['assets/punch1.mp3', 'assets/punch2.mp3', 'assets/punch3.mp3'];

  const music = new Audio('assets/menumusic.mp3');
  music.loop = true;
  music.preload = 'auto';

  const click = new Audio('assets/popclick.mp3');
  const hover = new Audio('assets/popclick.mp3');
  click.preload = 'auto';
  hover.preload = 'auto';

  const punch = PUNCHES.map((src) => {
    const a = new Audio(src);
    a.preload = 'auto';
    return a;
  });

  const pickupA = new Audio('assets/popclick.mp3');   // normal material blip
  const pickupB = new Audio('assets/popclick.mp3');   // alternate when setting on
  pickupA.preload = 'auto';
  pickupB.preload = 'auto';

  let unlocked = false;
  let wanted = false;      // music desired but maybe blocked by autoplay policy
  let focusMuted = false;  // transient mute (window lost focus)

  /* volume bus: master scales everything; music/sound split channels */
  function vol(el, channel) {
    const S = KS.Settings.get();
    const master = S.master / 100;
    const ch = (channel === 'music' ? S.music : S.sound) / 100;
    return master * ch;
  }

  function applyVolumes() {
    music.volume = vol(music, 'music');
    click.volume = vol(click, 'sound');
    hover.volume = vol(hover, 'sound') * 0.55;    // hover blip quieter
    punch.forEach((p) => { p.volume = vol(p, 'sound') * 0.9; });
    pickupA.volume = vol(pickupA, 'sound') * 0.5;
    pickupB.volume = vol(pickupB, 'sound') * 0.5;
    const muted = focusMuted ? 0 : 1;
    [music, click, hover, ...punch, pickupA, pickupB].forEach((a) => {
      a.muted = focusMuted;
      void muted;
    });
  }
  applyVolumes();

  function startMusic() {
    wanted = true;
    if (music.paused) music.play().catch(() => { unlocked = false; });
  }

  function restartMusic() {   // full restart from 0:00
    try {
      music.currentTime = 0;
      music.loop = true;
      if (unlocked) music.play().catch(() => {});
    } catch (e) { /* not loaded yet */ }
    wanted = true;
  }

  function stopMusic() {
    music.pause();
    wanted = false;
  }

  /* Autoplay unlock: the first user gesture anywhere starts the music. */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    applyVolumes();
    if (wanted && music.paused) startMusic();
  }
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });

  /* mute-on-focus-loss setting */
  window.addEventListener('blur', () => {
    if (KS.Settings.get().muteOnFocusLoss) { focusMuted = true; applyVolumes(); }
  });
  window.addEventListener('focus', () => {
    if (focusMuted) { focusMuted = false; applyVolumes(); }
  });

  function sfx(el, rate) {
    try {
      el.currentTime = 0;
      el.playbackRate = rate;
      el.play().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  let lastHover = 0;
  let lastPickup = 0;

  /* ---------------- enemy ability sounds (WebAudio synth) ----------------
     Small distinct cues for important enemy abilities (spec §10).
     Volume rides the same master/sound bus as every other SFX. */
  let AC = null;
  function actx() {
    if (!AC) {
      try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { AC = null; }
    }
    return AC;
  }
  function gainNow() {
    const S = KS.Settings.get();
    return Math.max(0, Math.min(1, (S.master / 100) * (S.sound / 100)))
      * (focusMuted ? 0 : 1);
  }
  /* one enveloped oscillator sweep */
  function tone(kind, f0, f1, dur, vol, type = 'sine', delay = 0) {
    const ac = actx();
    if (!ac || !wanted) return;
    const g = gainNow();
    if (g <= 0) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * g), t0 + Math.min(0.04, dur * 0.3));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env); env.connect(ac.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  const ABILITY_CUES = {
    rushWarn()  { tone('rushWarn', 300, 520, 0.16, 0.10, 'square'); tone('rushWarn', 300, 520, 0.16, 0.08, 'square', 0.18); },
    dash()      { tone('dash', 700, 120, 0.22, 0.12, 'sawtooth'); },
    lock()      { tone('lock', 900, 900, 0.06, 0.10, 'square'); tone('lock', 1150, 1150, 0.06, 0.10, 'square', 0.09); },
    flush()     { tone('flush', 320, 60, 0.5, 0.14, 'triangle'); tone('flush', 180, 45, 0.45, 0.10, 'sawtooth', 0.03); },
    soundwave() { tone('soundwave', 130, 55, 0.42, 0.13, 'sine'); tone('soundwave', 260, 110, 0.3, 0.07, 'sine', 0.02); },
    frenzy()    { [520, 660, 780, 990].forEach((f, i) => tone('frenzy', f, f, 0.06, 0.07, 'square', i * 0.055)); },
    cloud()     { tone('cloud', 240, 130, 0.4, 0.09, 'triangle'); },
    shield()    { tone('shield', 620, 930, 0.22, 0.11, 'sine'); tone('shield', 930, 1240, 0.18, 0.07, 'sine', 0.1); },
    split()     { tone('split', 500, 140, 0.3, 0.12, 'triangle'); },
    bossRoar()  { tone('bossRoar', 90, 42, 1.0, 0.30, 'sawtooth'); tone('bossRoar', 180, 60, 0.8, 0.14, 'square', 0.05); },
    bossDie()   { tone('bossDie', 220, 36, 1.1, 0.26, 'sawtooth'); tone('bossDie', 440, 60, 0.9, 0.12, 'square', 0.08); },
  };

  return {
    get _els() { return { music, click, hover, punch }; },
    applyVolumes,
    startMusic,
    restartMusic,
    stopMusic,
    clickSfx() { sfx(click, 1); },
    hoverSfx() {           // debounce so sliding across buttons isn't machine-gun
      const now = performance.now();
      if (now - lastHover < 70) return;
      lastHover = now;
      sfx(hover, KS.CONFIG.AUDIO.hoverRate);
    },
    /* random punch per attack */
    punchSfx() {
      sfx(punch[(Math.random() * punch.length) | 0], 0.9 + Math.random() * 0.2);
    },
    /* material pickup blip; alternate pitch when setting enabled */
    pickupSfx() {
      const now = performance.now();
      if (now - lastPickup < 40) return;   // avoid overlap machine-gun
      lastPickup = now;
      if (KS.Settings.get().changeMaterialSounds) sfx(pickupB, 1.25);
      else sfx(pickupA, 1.05);
    },
    /* enemy/boss ability cue by name (no-op when sound is off) */
    abilitySfx(name) {
      const fn = ABILITY_CUES[name];
      if (fn) fn();
    },
  };
})();
