/* =========================================================
   Boot: asset loading, screen flow, settings UI, pause menu,
   wave-break flow (banner -> Level Up -> Shop) & HUD binding.
   Flow: Menu -> Characters -> Weapons -> Difficulty -> Run ->
         (Pause) / (Wave end: WAVE COMPLETED -> LEVEL UP! ->
         Shop (Wave X) -> Go next wave) -> Death / Victory
   ========================================================= */
window.KS = window.KS || {};
(function () {
  const $ = (id) => document.getElementById(id);
  const C = KS.CONFIG;

  const ASSETS = {
    menuImg:  'assets/MenuBackground.jpg',
    map:      'assets/MapBackground.jpg',
    portrait: 'assets/KensingerBalanced.png',
    fist:     'assets/fistAttack.png',
    hand:     'assets/handAttack.png',     // replaced hand attack visual (spec §5)
    knife:    'assets/knifeAttack.png',    // knife attack visual (spec §6)
    turretT1: 'assets/buildersTurretT1.png',
    turretT2: 'assets/buildersTurretT2.png',
    turretT3: 'assets/buildersTurretT3.png',
    turretT4: 'assets/buildersTurretT4.png',
    /* enemy sprites (drawn by js/enemies.js) */
    eIphone:  'assets/enemies/iphone.png',
    eCamera:  'assets/enemies/camera.png',
    eChatgpt: 'assets/enemies/chatgpt.png',
    eToilet:  'assets/enemies/toilet.png',
    eGemini:  'assets/enemies/gemini.png',
    eTiktok:  'assets/enemies/tiktok.png',
    eClaude:  'assets/enemies/claude.png',
    eDrugs:   'assets/enemies/drugs.png',
  };

  /* ---------------- run selection state ---------------- */
  let currentChar = null;
  /* preloaded portrait images per character id (filled in boot) */
  const charPortraits = {};
  let currentWeaponId = null;
  let currentDifficulty = 0;
  const runSettings = { map: 'plains', endless: false };

  let game = null;
  let paused = false;
  let statsTab = 'primary';
  let debugOn = false;             // enemy-system debug overlay (toggle: B)
  let confirmAction = null;
  let lastTimerSec = -1;
  let lastKills = -1;
  let lastMaterials = -1;
  let lastWave = -1;

  /* break-flow state */
  let bannerTimer = null;
  let typeTimer = null;
  let luRerolls = 0;               // level-up rerolls this screen
  let luChoices = [];
  let shopEntries = null;          // current 4 shop slots
  let shopRerolls = 0;             // shop rerolls this visit
  let lastShopEntries = null;      // persists locked cards between waves
  let hoveredShopIdx = 0;

  const fmtTime = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  };

  /* =========================================================
     Small helpers
     ========================================================= */
  function toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden', 'fade');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.add('fade'), ms);
    clearTimeout(toast._h2);
    toast._h2 = setTimeout(() => t.classList.add('hidden'), ms + 300);
  }

  function hideTooltip() { $('tooltip').classList.add('hidden'); }
  function showTooltip(html, x, y) {
    const tt = $('tooltip');
    tt.innerHTML = html;
    tt.classList.remove('hidden');
    const r = tt.getBoundingClientRect();
    let px = x + 16, py = y + 16;
    if (px + r.width > window.innerWidth - 8) px = x - r.width - 12;
    if (py + r.height > window.innerHeight - 8) py = y - r.height - 12;
    tt.style.left = px + 'px';
    tt.style.top = py + 'px';
  }

  function bindBtn(el, fn) {
    if (!el) return;
    el.addEventListener('click', (e) => { KS.Audio.clickSfx(); fn && fn(e); });
    el.addEventListener('mouseenter', () => KS.Audio.hoverSfx());
  }
  function bindHoverSound(el) {
    if (el) el.addEventListener('mouseenter', () => KS.Audio.hoverSfx());
  }

  /* Icon helper: tries an image file first, falls back to an emoji.
     Lets custom art be dropped into assets/ later without code changes:
       assets/stats/<key>.png            — pause/break stats logos
       assets/upgrades/<key>_t<tier>.png — level-up upgrade images
       assets/items/<id>.png             — shop item icons
     Results are cached so a missing file 404s at most once. */
  const _iconCache = {};
  function makeIcon(src, emoji, cls) {
    if (_iconCache[src] === 'emoji') {
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = emoji;
      return span;
    }
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    if (cls) img.className = cls;
    img.onerror = () => {
      _iconCache[src] = 'emoji';
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = emoji;
      img.replaceWith(span);
    };
    return img;
  }

  const STAT_LABELS = {
    maxHP: 'Max HP', hpRegen: 'HP Regeneration', lifeSteal: 'Life Steal',
    damage: '% Damage', meleeDMG: 'Melee Damage', rangedDMG: 'Ranged Damage',
    elementalDMG: 'Elemental Damage', attackSpeed: '% Attack Speed',
    critChance: '% Crit Chance', engineering: 'Engineering', range: 'Range',
    armor: 'Armor', dodge: '% Dodge', speedPct: '% Speed', luck: 'Luck',
    harvesting: 'Harvesting', consumableHeal: 'Consumable Heal',
    materialsHealing: '% Materials Healing', xpGain: '% XP Gain',
    pickupRange: '% Pickup Range', itemPrice: '% Item Price',
    explosionDamage: '% Explosion Damage', explosionSize: '% Explosion Size',
    bounces: 'Bounces', piercing: 'Piercing', piercingDamage: '% Piercing Damage',
    bossDamage: '% Damage against bosses', structureAttackSpeed: '% Structure attack speed',
    structureRange: 'Structure Range', burningSpeed: '% Burning Speed',
    burningSpread: 'Burning Spread', knockback: 'Knockback',
    doubleMaterial: '% Double Material Chance', freeRerolls: 'Free Rerolls',
    trees: 'Trees', enemiesPct: '% Enemies', enemySpeedPct: '% Enemy Speed',
    rerollPrice: '% Reroll Price', curse: 'Curse',
  };

  /* =========================================================
     Shared stat text builders
     ========================================================= */
  function charStatLines(ch) {
    const w = C.WEAPONS[ch.startingWeapon];
    const tier = KS.tierInfo(ch.startingWeaponTier);
    const lines = (KS.L(ch.bonusLines) || []).map((b) => [b, '']);
    lines.push([KS.t('startingWeapon'), `${KS.L(w.name)} — ${tier.name}`]);
    return lines;
  }

  function weaponClasses(def) {
    return (def.classes && def.classes.length) ? def.classes.join(', ') : (def.desc || '');
  }

  function weaponStatLines(def, tier) {
    const tdef = def.tiers[tier];
    const info = KS.tierInfo(tier);
    const scalingPct = def.scalingPct == null ? 100 : def.scalingPct;
    const scaleName = def.scalingStat === 'meleeDMG' ? 'Melee DMG' : def.scalingStat;
    const lines = [
      ['Tier', { text: `T${tier} · ${info.name}`, color: info.color }],
      ['Damage', `${tdef.damage} (${scalingPct}% ${scaleName})`],
      ['Attack Speed', `${tdef.cooldown}s`],
      ['DPS', `${(tdef.damage / tdef.cooldown).toFixed(1)} (${Math.floor(scalingPct / tdef.cooldown)}%)/s`],
      ['Crit', `x${def.critMult} damage, ${Math.round(def.critChance * 100)}% chance`],
      ['Range', def.range],
      ['Knockback', def.knockback],
      ['Lifesteal', def.lifesteal || 0],
    ];
    if (tdef.special) lines.push(['Effect', { text: tdef.special, color: '#7fe694' }]);
    return lines;
  }

  function renderStatLines(el, lines) {
    el.innerHTML = '';
    for (const [k, v] of lines) {
      const row = document.createElement('div');
      row.className = 'stat-line';
      const isObj = v && typeof v === 'object';
      /* bonus lines carry their own text and no right-hand value */
      row.innerHTML = `<span>${k}</span>` +
        (v === '' ? '' : `<b ${isObj ? `style="color:${v.color}"` : ''}>${isObj ? v.text : v}</b>`);
      el.appendChild(row);
    }
  }

  function weaponTooltipHtml(def, tier) {
    const info = KS.tierInfo(tier);
    const rows = weaponStatLines(def, tier)
      .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:18px">
        <span style="opacity:.65">${k}</span><b>${typeof v === 'object' ? v.text : v}</b></div>`).join('');
    return `<div class="tt-title" style="color:${info.color}">${KS.L(def.name)} — T${tier} ${info.name}</div>
      <div style="opacity:.75;font-style:italic;margin-bottom:5px">${weaponClasses(def)}</div>${rows}`;
  }

  function itemTooltipHtml(itemDef) {
    const info = KS.tierInfo(itemDef.tier);
    const fx = itemDef.fx.map(([k, v]) =>
      `<div style="color:#8f8">+${v} ${SL(k)}</div>`).join('');
    return `<div class="tt-title" style="color:${info.color}">${itemDef.icon} ${KS.L(itemDef.name)} — T${itemDef.tier} ${info.name}</div>${fx}`;
  }

  /* =========================================================
     Screens
     ========================================================= */
  function setScreen(name) {
    for (const s of ['menu', 'settings', 'characters', 'weapons', 'difficulty'])
      $(s).classList.toggle('visible', s === name);
    $('hud').classList.toggle('visible', name === 'game');
    $('pause').classList.remove('visible', 'confirming');
    $('levelup').classList.remove('visible');
    $('shop').classList.remove('visible');
    $('gameover').classList.remove('visible');
    $('wavebanner').classList.add('hidden');
    $('pm-confirm').classList.add('hidden');
    closeWeaponManage();
    hideTooltip();
    closeMapList();
  }
  const showMenu       = () => { setScreen('menu'); KS.applyI18n(); };
  const showSettings   = () => { setScreen('settings'); KS.applyI18n(); };

  function showCharacters() {
    setScreen('characters');
    buildCharSlots();
    /* preview the CHOSEN character (defaults to Kensinger only before
       any pick has been made this session) */
    const ch = currentChar || C.CHARACTERS.balanced;
    updateCharPreview(ch);
    updateRecordBox(ch);
  }

  function showWeapons() {
    setScreen('weapons');
    $('ws-char-img').src = currentChar.portrait;
    $('ws-char-title').textContent = currentChar.name;
    renderStatLines($('ws-char-stats'), charStatLines(currentChar));
    buildWeaponSlots();
    updateWeaponBox(C.WEAPONS[currentChar.startingWeapon], currentChar.startingWeaponTier);
  }

  function showDifficulty() {
    setScreen('difficulty');
    $('ds-char-img').src = currentChar.portrait;
    $('ds-char-title').textContent = currentChar.name;
    renderStatLines($('ds-char-stats'), charStatLines(currentChar));
    buildDiffSlots();
    updateDiffBox(currentDifficulty);
  }

  /* =========================================================
     Character select screen
     ========================================================= */
  const SLOT_COUNT = 12;

  /* localized stat display name (stat_<key> in i18n, English fallback) */
  const SL = (k) => {
    const key = 'stat_' + k;
    const s = KS.t(key);
    return (s && s !== key) ? s : (STAT_LABELS[k] || k);
  };

  function buildCharSlots() {
    const row = $('char-slots');
    row.innerHTML = '';

    const q = document.createElement('div');
    q.className = 'slot';
    q.innerHTML = '<span class="qmark">❓</span>';
    q.title = '???';
    bindHoverSound(q);
    q.addEventListener('mouseenter', () => updateCharPreview(null));
    bindBtn(q, () => toast(KS.t('mysterySoon')));
    row.appendChild(q);

    for (const id of Object.keys(C.CHARACTERS)) {
      const ch = C.CHARACTERS[id];
      const s = document.createElement('div');
      s.className = 'slot' + (currentChar && currentChar.id === ch.id ? ' selected' : '');
      s.innerHTML = `<img src="${ch.portrait}" alt="${KS.L(ch.name) || ch.id}">`;
      bindHoverSound(s);
      const choose = () => {
        currentChar = ch;
        [...row.querySelectorAll('.slot.selected')].forEach(el => el.classList.remove('selected'));
        s.classList.add('selected');
        updateCharPreview(ch);
        updateRecordBox(ch);
      };
      s.addEventListener('mouseenter', () => {
        updateCharPreview(ch);
        updateRecordBox(ch);
      });
      bindBtn(s, () => {
        choose();
        showWeapons();
      });
      row.appendChild(s);
    }

    for (let i = row.children.length; i < SLOT_COUNT; i++) {
      const s = document.createElement('div');
      s.className = 'slot locked';
      s.innerHTML = '<span class="lockmark">🔒</span>';
      bindHoverSound(s);
      bindBtn(s, () => toast(KS.t('lockedChar')));
      row.appendChild(s);
    }
  }

  function updateCharPreview(ch) {
    const img = $('cs-preview-img');
    const stats = $('cs-preview-stats');
    if (!ch) {
      $('cs-preview-title').textContent = '???';
      $('cs-preview-tag').textContent = 'A mysterious Kensinger. Who could it be?';
      img.removeAttribute('src');
      img.style.display = 'none';
      const holder = img.parentElement;
      if (!holder.querySelector('.qmark')) {
        const q = document.createElement('span');
        q.className = 'qmark';
        q.style.fontSize = '84px';
        holder.appendChild(q);
      }
      stats.innerHTML = '<div class="stat-line"><span>Stats</span><b>???</b></div>';
      return;
    }
    img.style.display = '';
    const holder = img.parentElement;
    const q = holder.querySelector('.qmark');
    if (q) q.remove();
    img.src = ch.portrait;
    $('cs-preview-title').textContent = KS.L(ch.name);
    $('cs-preview-tag').textContent = KS.L(ch.tagline);
    renderStatLines(stats, charStatLines(ch));
  }

  function updateRecordBox(ch) {
    const box = $('cs-record');
    box.innerHTML = '';
    const r = KS.Records.get(ch.id);
    if (!r.beaten || r.beaten.length === 0) return;

    const mk = (k, v) => {
      const d = document.createElement('div');
      d.className = 'record-line';
      d.innerHTML = `<span>${k}</span><b>${v}</b>`;
      box.appendChild(d);
    };
    mk(KS.t('diffBeaten'), r.beaten.join(', '));
    mk(KS.t('timesPlayed'), r.played);
    mk(KS.t('wins'), r.wins);
    mk(KS.t('deaths'), r.deaths);
  }

  /* --- run options --- */
  function closeMapList() {
    const l = $('map-list');
    if (l) l.classList.add('hidden');
  }
  function buildRunOptions() {
    bindBtn($('btn-map'), () => $('map-list').classList.toggle('hidden'));
    for (const item of document.querySelectorAll('.map-item')) {
      bindBtn(item, () => {
        if (item.disabled || item.classList.contains('unavailable')) return;
        for (const it of document.querySelectorAll('.map-item')) it.classList.remove('selected');
        item.classList.add('selected');
        runSettings.map = item.dataset.map;
        $('map-label').textContent = C.MAPS[runSettings.map].name;
        closeMapList();
      });
    }
    bindBtn($('btn-endless'), () => {
      runSettings.endless = !runSettings.endless;
      $('endless-state').textContent = runSettings.endless ? '☑' : '▢';
      $('btn-endless').classList.toggle('active', runSettings.endless);
    });
    bindBtn($('btn-coop'), () => toast(KS.t('coopSoon')));
  }

  /* =========================================================
     Weapon select screen
     ========================================================= */
  /* weapons the current character may pick as a starting weapon
     (Adkins only gets "Unarmed"-tagged weapons) */
  function allowedWeapons() {
    const f = currentChar && currentChar.weaponFilter;
    if (!f) return Object.keys(C.WEAPONS);
    return Object.keys(C.WEAPONS)
      .filter((id) => C.WEAPONS[id].classes &&
        C.WEAPONS[id].classes.some((c) => f.includes(c)));
  }

  function buildWeaponSlots() {
    const row = $('weapon-slots');
    row.innerHTML = '';
    const allowed = allowedWeapons();

    const q = document.createElement('div');
    q.className = 'slot';
    q.innerHTML = '<span class="qmark">❓</span>';
    bindHoverSound(q);
    q.addEventListener('mouseenter', () => {
      $('wp-img').style.opacity = 0.25;
      $('wp-title').textContent = '?';
      $('wp-desc').textContent = KS.t('randomWeaponDesc');
      $('wp-stats').innerHTML = '';
    });
    q.addEventListener('mouseleave', () => {
      const w = C.WEAPONS[currentChar.startingWeapon];
      updateWeaponBox(w, currentChar.startingWeaponTier);
    });
    bindBtn(q, () => {
      const pick = allowed[(Math.random() * allowed.length) | 0];
      currentWeaponId = pick;
      const w = C.WEAPONS[pick];
      toast(KS.t('randomWeaponPick', KS.L(w.name)), 1200);
      setTimeout(showDifficulty, 350);
    });
    row.appendChild(q);

    for (const id of allowed) {
      const w = C.WEAPONS[id];
      const s = document.createElement('div');
      s.className = 'slot selected';
      s.innerHTML = `<img src="${w.icon}" alt="${KS.L(w.name)}">`;
      bindHoverSound(s);
      s.addEventListener('mouseenter', () => updateWeaponBox(w, currentChar.startingWeaponTier));
      bindBtn(s, () => {
        currentWeaponId = id;
        showDifficulty();
      });
      row.appendChild(s);
    }

    for (let i = row.children.length; i < SLOT_COUNT; i++) {
      const s = document.createElement('div');
      s.className = 'slot locked';
      s.innerHTML = '<span class="lockmark">🔒</span>';
      bindHoverSound(s);
      bindBtn(s, () => toast(KS.t('lockedWeapon')));
      row.appendChild(s);
    }
  }

  function updateWeaponBox(w, tier) {
    $('wp-img').style.opacity = 1;
    $('wp-img').src = w.icon;
    $('wp-title').textContent = KS.L(w.name);
    /* the class tags sit right under the weapon title */
    $('wp-desc').textContent = weaponClasses(w);
    renderStatLines($('wp-stats'), weaponStatLines(w, tier));
  }

  /* =========================================================
     Difficulty select screen
     ========================================================= */
  function buildDiffSlots() {
    const row = $('diff-slots');
    row.innerHTML = '';
    for (let d = 0; d < C.DIFFICULTY_SLOTS; d++) {
      const unlocked = KS.Records.isDifficultyUnlocked(currentChar.id, d);
      const s = document.createElement('div');
      s.className = 'slot' + (d === 0 ? ' zero' : '') + (unlocked ? ' selected' : ' locked');
      s.innerHTML = unlocked
        ? `<span class="diff-num">${d}</span>`
        : '<span class="lockmark">🔒</span>';
      s.title = C.DIFFICULTIES[d].name;
      bindHoverSound(s);
      const dd = d;
      s.addEventListener('mouseenter', () => updateDiffBox(dd));
      if (unlocked) {
        bindBtn(s, () => {
          currentDifficulty = dd;
          startRun();
        });
      } else {
        bindBtn(s, () => toast(KS.t('diffUnlock', dd)));
      }
      row.appendChild(s);
    }
  }

  function updateDiffBox(d) {
    const def = C.DIFFICULTIES[d];
    $('dp-badge').textContent = d;
    $('dp-title').textContent = KS.L(def.name);
    $('dp-desc').textContent = d === 0
      ? KS.t('noModifiers')
      : KS.t('diffTough');
    const stats = $('dp-stats');
    if (!def.lines || def.lines.length === 0) {
      stats.innerHTML = `<div class="stat-line"><span>${KS.t('modifier')}</span><b>${KS.t('none')}</b></div>`;
    } else {
      stats.innerHTML = def.lines
        .map((l) => `<div class="stat-line"><span>${KS.t('modifier')}</span><b>${l}</b></div>`).join('');
    }
  }

  /* =========================================================
     Settings screen
     ========================================================= */
  function buildSettings() {
    /* tabs */
    for (const tab of document.querySelectorAll('.set-tab')) {
      bindBtn(tab, () => {
        for (const t of document.querySelectorAll('.set-tab')) t.classList.remove('selected');
        tab.classList.add('selected');
        for (const p of document.querySelectorAll('.set-pane')) p.classList.add('hidden');
        $('set-' + tab.dataset.tab).classList.remove('hidden');
      });
    }

    /* sliders */
    const sliders = [
      ['set-master', 'master', 'val-master'],
      ['set-soundvol', 'sound', 'val-soundvol'],
      ['set-music', 'music', 'val-music'],
      ['set-explosion', 'explosionOpacity', 'val-explosion'],
      ['set-projectile', 'projectileOpacity', 'val-projectile'],
      ['set-pet', 'petOpacity', 'val-pet'],
      ['set-fontsize', 'fontSize', 'val-fontsize'],
    ];
    for (const [id, key, valId] of sliders) {
      const el = $(id);
      el.value = KS.Settings.get()[key];
      $(valId).textContent = el.value + '%';
      el.addEventListener('input', () => {
        $(valId).textContent = el.value + '%';
        KS.Settings.set(key, Number(el.value));
      });
    }

    /* language select */
    const lang = $('set-language');
    lang.value = KS.Settings.get().language;
    lang.addEventListener('change', () => {
      KS.Settings.set('language', lang.value);
      KS.applyI18n();
      $('map-label').textContent = C.MAPS[runSettings.map].name;
    });

    /* toggle buttons */
    for (const btn of document.querySelectorAll('.toggle-btn')) {
      const key = btn.dataset.setting;
      refreshToggle(btn, KS.Settings.get()[key]);
      bindBtn(btn, () => {
        const v = !KS.Settings.get()[key];
        KS.Settings.set(key, v);
        refreshToggle(btn, v);
      });
    }
  }

  function refreshToggle(btn, v) {
    btn.textContent = v ? 'ON' : 'OFF';
    btn.classList.toggle('on', !!v);
  }

  /* =========================================================
     Run flow
     ========================================================= */
  function startRun() {
    KS.Records.addPlayed(currentChar.id);
    if (KS.DevCmd) KS.DevCmd.resetHistory();   // undo history is per-run
    paused = false;
    lastTimerSec = -1; lastKills = -1; lastMaterials = -1; lastWave = -1;
    luRerolls = 0; luChoices = [];
    shopEntries = null; shopRerolls = 0; lastShopEntries = null;
    clearTimeout(bannerTimer); clearTimeout(typeTimer);
    setScreen('game');
    refreshHudWeapon();
    game.start(currentChar, {
      weaponId: currentWeaponId || currentChar.startingWeapon,
      difficulty: currentDifficulty,
      endless: runSettings.endless,
      map: runSettings.map,
      /* the player sprite in the arena must be the chosen character,
         never the hardcoded Kensinger default */
      portrait: charPortraits[currentChar.id],
    });
  }

  /* ---- in-run HUD: ONE CHIP PER WEAPON INSTANCE (spec §10) ----
     Identical weapons each get their own chip (own uid, tier, cooldown
     overlay) — the old single-slot HUD showed only one weapon and hid
     duplicates. Rebuilds only when the instance signature changes. */
  let hudWeaponSig = '';
  function refreshHudWeapon() {
    if (!game || !game.weapons) return;   // also before game.start()
    const wrap = $('weapon-slot');
    /* uid counters reset per run — the def id disambiguates identical
       signatures across runs (two-run stale-chip bug) */
    const sig = game.weapons.map((w) => w.def.id + ':' + w.uid + ':' + w.tier).join('|');
    if (sig === hudWeaponSig) return;
    hudWeaponSig = sig;
    wrap.innerHTML = '';
    for (const w of game.weapons) {
      const info = KS.tierInfo(w.tier);
      const chip = document.createElement('div');
      chip.className = 'weapon-chip';
      chip.style.borderColor = info.color;
      chip.innerHTML = `
        <div class="weapon-icon-wrap">
          <img src="${w.def.icon}" alt="${KS.L(w.def.name)}">
          <div class="weapon-cd" data-uid="${w.uid}"></div>
        </div>
        <div class="weapon-info">
          <div class="weapon-name">${KS.L(w.def.name)}</div>
          <div class="weapon-tier" style="color:${info.color}">T${w.tier} · ${info.name}</div>
        </div>`;
      chip.addEventListener('mousemove', (e) =>
        showTooltip(weaponTooltipHtml(w.def, w.tier), e.clientX, e.clientY));
      chip.addEventListener('mouseleave', hideTooltip);
      wrap.appendChild(chip);
    }
  }

  function setPaused(v) {
    if (!game || !game.running || game.over || game.state !== 'wave') return;
    paused = v;
    game.paused = v;
    if (v) {
      openPause();
      $('pause').classList.add('visible');
    } else {
      $('pause').classList.remove('visible', 'confirming');
      $('pm-confirm').classList.add('hidden');
      confirmAction = null;
      hideTooltip();
    }
  }

  /* =========================================================
     Shared stats list (pause / level-up / shop)
     ========================================================= */
  const STAT_ICONS = {
    Level: ['level', '⭐'], Curse: ['curse', '😈'], 'Max HP': ['maxHP', '❤️'],
    'HP Regeneration': ['hpRegen', '🫁'], '% Life Steal': ['lifeSteal', '🦷'],
    '% Damage': ['damage', '💪'], '% Attack Speed': ['attackSpeed', '⚡'],
    '% Crit Chance': ['critChance', '🤞'], '% Dodge': ['dodge', '🧥'],
    '% Speed': ['speedPct', '🦵'], 'Melee Damage': ['meleeDMG', '🤜'],
    'Ranged Damage': ['rangedDMG', '🦾'], 'Elemental Damage': ['elementalDMG', '🧠'],
    Engineering: ['engineering', '💀'], Range: ['range', '👁️'], Armor: ['armor', '🦺'],
    Luck: ['luck', '👃'], Harvesting: ['harvesting', '🤲'],
  };

  const PRIMARY_STATS = [
    { label: 'Level',           val: (s, g) => g.level,
      tipKey: 'stLevel', tipArg: (s, g) => [g.level] },
    { label: 'Curse',           val: (s) => s.curse || 0,
      tipKey: 'stCurse', tipArg: (s) => [s.curse || 0] },
    { label: 'Max HP',          val: (s) => s.maxHP,
      tipKey: 'stMaxHP', tipArg: (s) => [s.maxHP] },
    { label: 'HP Regeneration', val: (s) => s.hpRegen,
      tipKey: 'stHpRegen', tipArg: (s) => [KS.hpRegenRate(s.hpRegen)] },
    { label: '% Life Steal',    val: (s) => s.lifeSteal,
      tipKey: 'stLifeSteal', tipArg: (s) => [s.lifeSteal] },
    { label: '% Damage',        val: (s) => s.damage,
      tipKey: 'stDamage', tipArg: (s) => [s.damage] },
    { label: '% Attack Speed',  val: (s) => s.attackSpeed,
      tipKey: 'stAttackSpeed', tipArg: (s) => [s.attackSpeed] },
    { label: '% Crit Chance',   val: (s, g) =>
        Math.round(g.weapons[0].def.critChance * 100) + (s.critChance || 0),
      tipKey: 'stCrit', tipArg: (s, g) =>
        [Math.round(g.weapons[0].def.critChance * 100) + (s.critChance || 0)] },
    { label: '% Dodge',         val: (s) => s.dodge,
      tipKey: 'stDodge', tipArg: (s) => [s.dodge] },
    { label: '% Speed',         val: (s) => s.speedPct,
      tipKey: 'stSpeed', tipArg: (s) => [s.speedPct] },
    { label: 'Melee Damage',    val: (s) => s.meleeDMG,
      tipKey: 'stMelee', tipArg: (s) => [s.meleeDMG] },
    { label: 'Ranged Damage',   val: (s) => s.rangedDMG,
      tipKey: 'stRanged', tipArg: (s) => [s.rangedDMG] },
    { label: 'Elemental Damage', val: (s) => s.elementalDMG,
      tipKey: 'stElemental', tipArg: (s) => [s.elementalDMG] },
    { label: 'Engineering',     val: (s) => s.engineering,
      tipKey: 'stEngineering', tipArg: () => [] },
    { label: 'Range',           val: (s, g) => g.weapons[0].def.range + (s.range || 0),
      tipKey: 'stRange', tipArg: (s) => [s.range] },
    { label: 'Armor',           val: (s) => s.armor,
      tipKey: 'stArmor', tipArg: (s) => [KS.armorReduction(s.armor)] },
    { label: 'Luck',            val: (s) => s.luck,
      tipKey: 'stLuck', tipArg: (s) => [s.luck] },
    { label: 'Harvesting',      val: (s) => s.harvesting,
      tipKey: 'stHarvesting', tipArg: (s) => [s.harvesting] },
  ];

  const SECONDARY_STATS = [
    'consumableHeal', 'materialsHealing', 'xpGain', 'pickupRange', 'itemPrice',
    'explosionDamage', 'explosionSize', 'bounces', 'piercing', 'piercingDamage',
    'bossDamage', 'structureAttackSpeed', 'structureRange', 'burningSpeed',
    'burningSpread', 'knockback', 'doubleMaterial', 'freeRerolls', 'trees',
    'enemiesPct', 'enemySpeedPct', 'rerollPrice',
  ];

  function renderStatsList(el, snap, withIcons = true) {
    const s = snap.stats;
    el.innerHTML = '';
    const rows = statsTab === 'primary' || el.id !== 'pm-stats-list'
      ? PRIMARY_STATS.map((d) => [d.label, d.val(s, game), d.tipKey, d.tipArg])
      : SECONDARY_STATS.map((key) => [SL(key), s[key] || 0, null, null]);

    for (const [label, value, tipKey, tipArg] of rows) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      const nameEl = document.createElement('span');
      nameEl.className = 'sname';
      if (withIcons && STAT_ICONS[label]) {
        const [key, emoji] = STAT_ICONS[label];
        nameEl.appendChild(makeIcon(`assets/stats/${key}.png`, emoji, 'sicon'));
      }
      nameEl.appendChild(document.createTextNode(label));
      const valEl = document.createElement('span');
      valEl.className = 'sval';
      valEl.textContent = value;
      row.append(nameEl, valEl);
      if (tipKey) {
        const tip = () => KS.t(tipKey, ...(tipArg ? tipArg(s, game) : []));
        row.addEventListener('mousemove', (e) =>
          showTooltip(`<div class="tt-title">${label}</div>${tip()}`, e.clientX, e.clientY));
        row.addEventListener('mouseleave', hideTooltip);
      }
      el.appendChild(row);
    }
  }

  function refreshAllStatsPanels() {
    const snap = game.snapshot();
    renderStatsList($('pm-stats-list'), snap);
    renderStatsList($('lu-stats-list'), snap);
    renderStatsList($('shop-stats-list'), snap);
  }

  /* =========================================================
     Pause menu
     ========================================================= */
  let markerDotX = [];

  function openPause() {
    const snap = game.snapshot();
    buildPauseWeapons(snap);
    buildPauseItems(snap);
    renderStatsList($('pm-stats-list'), snap);
    $('btn-stats-toggle').textContent = statsTab === 'primary' ? 'Secondary ▸' : '◂ Primary';
    buildWaveBar(snap);
  }

  function buildPauseWeapons(snap) {
    $('pm-weapons-title').textContent =
      `${KS.t('weapons')} (${snap.weapons.length}/${snap.maxWeapons})`;
    const box = $('pm-weapons');
    box.innerHTML = '';
    for (const w of snap.weapons) {
      const el = document.createElement('div');
      el.className = 'pm-icon';
      el.style.borderColor = KS.tierInfo(w.tier).color;
      el.innerHTML = `<img src="${w.def.icon}" alt="${KS.L(w.def.name)}">`;
      el.addEventListener('mousemove', (e) =>
        showTooltip(weaponTooltipHtml(w.def, w.tier), e.clientX, e.clientY));
      el.addEventListener('mouseleave', hideTooltip);
      box.appendChild(el);
    }
    for (let i = snap.weapons.length; i < snap.maxWeapons; i++) {
      const el = document.createElement('div');
      el.className = 'pm-icon';
      el.style.opacity = 0.35;
      el.innerHTML = '<span class="qmark">➕</span>';
      box.appendChild(el);
    }
  }

  function buildPauseItems(snap) {
    /* NO item limit, NO placeholder squares: the first square always
       shows the selected character, then one square per bought item */
    $('pm-items-title').textContent = `${KS.t('items')} (${snap.items.length})`;
    const box = $('pm-items');
    box.innerHTML = '';

    const chip = document.createElement('div');
    chip.className = 'pm-icon char-chip';
    chip.innerHTML = `<img src="${currentChar.portrait}" alt="${currentChar.name}">`;
    chip.addEventListener('mousemove', (e) => {
      const tip = `<div class="tt-title">${currentChar.name}</div>
        <div style="opacity:.7;font-style:italic;margin-bottom:4px">${KS.L(currentChar.tagline)}</div>` +
        (KS.L(currentChar.bonusLines) || []).map((b) => `<div>${b}</div>`).join('');
      showTooltip(tip, e.clientX, e.clientY);
    });
    chip.addEventListener('mouseleave', hideTooltip);
    box.appendChild(chip);

    for (const item of snap.items) {
      const el = document.createElement('div');
      el.className = 'pm-icon';
      el.style.borderColor = KS.tierInfo(item.tier).color;
      el.appendChild(makeIcon(`assets/items/${item.id}.png`, item.icon));
      el.addEventListener('mousemove', (e) =>
        showTooltip(itemTooltipHtml(item), e.clientX, e.clientY));
      el.addEventListener('mouseleave', hideTooltip);
      box.appendChild(el);
    }
    if (!snap.items.length) {
      const empty = document.createElement('span');
      empty.className = 'pm-empty';
      empty.textContent = '—';
      box.appendChild(empty);
    }
  }

  /* ---------------- wave bar (pause, bottom) ---------------- */
  function buildWaveBar(snap) {
    const dots = $('pm-dots');
    const marker = $('pm-marker');
    dots.innerHTML = '';
    const N = C.WAVES.length;
    markerDotX = [];
    const marks = new Set(C.WAVE_MARKS.filter((m) => m > 0));   // no "0" label

    const pos = (wv) => (wv / N) * 100;
    for (let wv = 1; wv <= N; wv++) {
      const pct = pos(wv);
      markerDotX[wv] = pct;
      const dot = document.createElement('div');
      dot.className = 'pm-dot' + (marks.has(wv) ? ' marked' : '');
      if (wv === 20) {
        dot.classList.add('final');
        dot.textContent = '💀';
      }
      dot.style.left = pct + '%';
      dots.appendChild(dot);
    }
    for (const wv of marks) {
      const lbl = document.createElement('div');
      lbl.className = 'pm-dot-label' + (wv === 20 ? ' final' : '');
      lbl.textContent = wv;
      lbl.style.left = pos(wv) + '%';
      dots.appendChild(lbl);
    }
    /* the character marker lives inside .pm-dots — restore it */
    if (marker) dots.appendChild(marker);

    updateWaveMarker(snap);
  }

  function updateWaveMarker(snap) {
    const N = C.WAVES.length;
    const wv = Math.min(Math.max(snap.wave, 1), N);
    $('pm-marker-img').src = currentChar.portrait;
    $('pm-marker').style.left = markerDotX[wv] + '%';
    const ch = currentChar;
    const tip = `<div class="tt-title">${ch.name}</div>
      <div style="opacity:.7;font-style:italic;margin-bottom:4px">${KS.L(ch.tagline)}</div>
      <div style="display:flex;justify-content:space-between;gap:16px"><span style="opacity:.65">${KS.t('waveX', snap.wave)}</span><b>${snap.wave}</b></div>
      <div style="display:flex;justify-content:space-between;gap:16px"><span style="opacity:.65">${KS.t('maxHP')}</span><b>${snap.stats.maxHP}</b></div>
      <div style="display:flex;justify-content:space-between;gap:16px"><span style="opacity:.65">${SL('damage')}</span><b>${snap.stats.damage}%</b></div>
      <div style="display:flex;justify-content:space-between;gap:16px"><span style="opacity:.65">${SL('speedPct')}</span><b>+${snap.stats.speedPct}%</b></div>`;
    const marker = $('pm-marker');
    marker.onmousemove = (e) => showTooltip(tip, e.clientX, e.clientY);
    marker.onmouseleave = hideTooltip;
  }

  /* ---------------- pause confirmations ---------------- */
  const CONFIRM_TEXTS = () => ({
    restart: [KS.t('confirmRestart'), KS.t('confirmRestartText')],
    end:     [KS.t('confirmEnd'), KS.t('confirmEndText')],
    quit:    [KS.t('confirmQuit'), KS.t('confirmQuitText')],
  });

  function askConfirm(action) {
    confirmAction = action;
    hideTooltip();
    const [title, text] = CONFIRM_TEXTS()[action];
    $('pm-confirm-title').textContent = title;
    $('pm-confirm-text').textContent = text;
    $('pm-confirm').classList.remove('hidden');
    $('pause').classList.add('confirming');
  }

  function closeConfirm() {
    confirmAction = null;
    hideTooltip();
    $('pm-confirm').classList.add('hidden');
    $('pause').classList.remove('confirming');
  }

  function doConfirm() {
    const action = confirmAction;
    closeConfirm();
    if (action === 'restart') {
      startRun();
    } else if (action === 'end') {
      game.stop();
      showCharacters();
      KS.Audio.restartMusic();
    } else if (action === 'quit') {
      game.stop();
      showMenu();
      KS.Audio.restartMusic();
    }
  }

  /* =========================================================
     Wave break flow: WAVE COMPLETED banner -> Level Up -> Shop
     ========================================================= */
  function onWaveComplete(waveEnded, harvest, crateItems, builderConv) {
    $('hud').classList.add('dimmed');
    showWaveBanner(() => {
      if (crateItems && crateItems.length) openCrateRewards(crateItems);
      else if (game.pendingLevels > 0) openLevelUp();
      else openShop();
    }, harvest, builderConv);
  }

  /* ---- loot crate reward screen: one item per collected crate;
     take it or recycle it for part of its price (spec §4) ---- */
  let crQueue = [];        // [{ item, special }]
  function openCrateRewards(pairs) {
    crQueue = pairs.slice();
    $('cr-title').textContent = KS.t('crateTitle');
    renderCrateReward();
    $('cratereward').classList.add('visible');
  }

  function crItemFxLines(it) {
    return (it.fx || []).map(([k, v]) => `+${v} ${SL(k)}`);
  }

  function renderCrateReward() {
    const { item, special } = crQueue[0];
    $('cr-remaining').textContent =
      KS.t('cratesRemaining').replace('{n}', String(crQueue.length));
    $('cr-icon').textContent = item.icon;
    $('cr-name').textContent = KS.L(item.name);
    $('cr-tier').textContent = special
      ? `${KS.t('crateSpecial')} — T${item.tier}`
      : `T${item.tier}`;
    $('cr-fx').innerHTML = crItemFxLines(item).map((l) => `<div>${l}</div>`).join('');
    const refund = Math.max(1, Math.round(item.price * KS.CONFIG.LOOT.crateRecyclePct));
    $('btn-cr-recycle').textContent = KS.t('crateRecycle').replace('{n}', String(refund));
  }

  function finishOneCrate(take) {
    const { item } = crQueue.shift();
    if (take) {
      game.buyItem(item);               // applies stat fx + registers ownership
    } else {
      game.materials += Math.max(1, Math.round(item.price * KS.CONFIG.LOOT.crateRecyclePct));
    }
    $('cratereward').classList.remove('visible');
    hideTooltip();
    if (crQueue.length) {
      setTimeout(() => {
        renderCrateReward();
        $('cratereward').classList.add('visible');
      }, 120);
    } else if (game.pendingLevels > 0) {
      openLevelUp();
    } else {
      openShop();
    }
  }

  function showWaveBanner(done, harvest, builderConv) {
    const wrap = $('wavebanner');
    const textEl = $('wavebanner-text');
    const subEl = $('wavebanner-sub');
    const msg = KS.t('waveCompleted');
    const parts = [];
    if (harvest && harvest > 0) {
      parts.push(KS.t('harvestIncome').replace('{n}', String(harvest)));
    }
    /* end-of-wave results show the Builder material conversion (spec §9) */
    if (builderConv > 0) parts.push(KS.t('builderConverted', String(builderConv)));
    subEl.textContent = parts.join('  ·  ');
    wrap.classList.remove('hidden');
    wrap.classList.toggle('no-dark', !KS.Settings.get().screenDarkening);

    /* smooth typing reveal */
    clearInterval(typeTimer);
    let i = 0;
    textEl.textContent = '';
    typeTimer = setInterval(() => {
      i++;
      textEl.textContent = msg.slice(0, i);
      if (i >= msg.length) clearInterval(typeTimer);
    }, 62);

    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      wrap.classList.add('hidden');
      done && done();
    }, 1500);
  }

  /* ---------------- Level Up screen ---------------- */
  /* rarity rolls at the level you "were" when earning the pick:
     first level-up (while level 1) is 100% Tier 1 per spec,
     Level 5 -> T2, 10/15/20 -> T3, 25 & every 5th -> T4. */
  function luRollLevel() {
    return Math.max(1, game.level - game.pendingLevels);
  }

  function openLevelUp() {
    luRerolls = 0;
    luChoices = KS.Upgrades.rollChoices(luRollLevel(), game.stats.luck);
    $('lu-title').textContent = KS.t('levelUp');
    renderLevelUp();
    $('levelup').classList.add('visible');
  }

  function luRerollCost() { return 2 + luRerolls; }

  function renderLevelUp() {
    const box = $('lu-choices');
    box.innerHTML = '';
    for (const upg of luChoices) renderUpgradeCard(box, upg);

    $('lu-reroll-label').textContent = KS.t('rerollCost', luRerollCost());
    $('lu-remaining').textContent = KS.t('choicesLeft', game.pendingLevels);
    renderStatsList($('lu-stats-list'), game.snapshot());
    $('shop-materials') && ($('shop-materials').textContent = game.materials);
  }

  function renderUpgradeCard(box, upg) {
    const info = KS.tierInfo(upg.tier);
    const def = upg.stat;
    const name = KS.Upgrades.statName(def);
    const upgradeName = def.names[upg.tier - 1] + ' Upgrade';
    const effect = KS.Upgrades.effectText(def, upg.tier);

    const card = document.createElement('div');
    card.className = 'up-card';
    card.style.borderColor = info.color;
    card.innerHTML = `
      <div class="up-tier" style="color:${info.color}">T${upg.tier} · ${info.name}</div>
      <div class="up-icon"></div>
      <div class="up-title">${name}</div>
      <div class="up-sub">${KS.t('upgrade')}</div>
      <div class="up-name">${upgradeName}</div>
      <div class="up-effect">${effect}</div>
      <button class="btn choose-btn">${KS.t('choose')}</button>
    `;
    card.querySelector('.up-icon').appendChild(
      makeIcon(`assets/upgrades/${def.key}_t${upg.tier}.png`, upg.icon));
    bindHoverSound(card);
    const choose = card.querySelector('.choose-btn');
    bindBtn(choose, () => chooseUpgrade(upg));
    box.appendChild(card);
  }

  function chooseUpgrade(upg) {
    /* Builder statMods scale upgrade gains (damage x0.25, engineering
       x1.5 for Bair The Builder — spec §8) */
    const gain = KS.Upgrades.apply(upg, game.stats, (k, v) => game.statGain(k, v));
    const hpGain = KS.Upgrades.maxHpGain(upg);
    if (hpGain > 0) game.player.refreshMaxHp(game.stats);
    game.pendingLevels--;
    renderStatsList($('lu-stats-list'), game.snapshot());

    if (game.pendingLevels > 0) {
      /* auto free reroll between picks */
      luChoices = KS.Upgrades.rollChoices(luRollLevel(), game.stats.luck);
      renderLevelUp();
    } else {
      $('levelup').classList.remove('visible');
      openShop();
    }
  }

  function rerollLevelUp() {
    const cost = luRerollCost();
    if (!game.spendMaterials(cost)) { toast(KS.t('needMaterials')); return; }
    luRerolls++;
    luChoices = KS.Upgrades.rollChoices(luRollLevel(), game.stats.luck);
    renderLevelUp();
  }

  /* ---------------- Shop screen ---------------- */
  function openShop() {
    shopRerolls = 0;
    shopEntries = KS.Shop.roll(game.wave, game.stats.luck, lastShopEntries);
    lastShopEntries = shopEntries;
    hoveredShopIdx = 0;
    $('shop-title').textContent = KS.t('shopWave', game.wave);
    $('btn-shop-go').textContent = KS.t('goNext', game.wave + 1);
    renderShop();
    $('shop').classList.add('visible');
  }

  function shopRerollCost() {
    /* buying all 4 choices makes the next reroll free */
    if (shopEntries && shopEntries.length && shopEntries.every((e) => e.sold)) return 0;
    return KS.Shop.rerollPrice(game.wave, shopRerolls);
  }

  function renderShop() {
    const box = $('shop-cards');
    box.innerHTML = '';
    shopEntries.forEach((entry, idx) => {
      box.appendChild(renderShopCard(entry, idx));
    });
    const cost = shopRerollCost();
    $('shop-reroll-label').textContent =
      cost === 0 ? KS.t('rerollFree') : KS.t('rerollCost', cost);
    $('shop-materials').textContent = game.materials;
    renderOwnedDisplay();
    renderStatsList($('shop-stats-list'), game.snapshot());
  }

  function entryTitleHtml(entry) {
    const info = KS.tierInfo(entry.tier);
    const isWeapon = entry.kind === 'weapon';
    const name = KS.L(isWeapon ? C.WEAPONS[entry.id].name : KS.Shop.itemDef(entry.id).name);
    /* weapon class tags sit right under the title */
    const classes = isWeapon
      ? `<div class="sc-classes">${weaponClasses(C.WEAPONS[entry.id])}</div>` : '';
    return `<div class="sc-icon"></div>
      <div class="sc-name" style="color:${info.color}">${name}</div>${classes}
      <div class="sc-tier" style="color:${info.color}">T${entry.tier} · ${info.name}</div>`;
  }

  function fillEntryIcon(card, entry) {
    const holder = card.querySelector('.sc-icon');
    if (entry.kind === 'weapon') {
      const def = C.WEAPONS[entry.id];
      const img = document.createElement('img');
      img.src = def.icon;
      img.alt = '';
      holder.appendChild(img);
    } else {
      const def = KS.Shop.itemDef(entry.id);
      holder.appendChild(makeIcon(`assets/items/${def.id}.png`, def.icon));
    }
  }

  function entryStatsHtml(entry) {
    if (entry.kind === 'weapon') {
      const def = C.WEAPONS[entry.id];
      return weaponStatLines(def, entry.tier).slice(1)
        .map(([k, v]) => `<div class="sc-stat"><span>${k}</span><b>${typeof v === 'object' ? v.text : v}</b></div>`)
        .join('');
    }
    const def = KS.Shop.itemDef(entry.id);
    return def.fx.map(([k, v]) =>
      `<div class="sc-stat"><span></span><b style="color:#7fe694">+${v} ${SL(k)}</b></div>`)
      .join('');
  }

  function entryTooltipHtml(entry) {
    return entry.kind === 'weapon'
      ? weaponTooltipHtml(C.WEAPONS[entry.id], entry.tier)
      : itemTooltipHtml(KS.Shop.itemDef(entry.id));
  }

  function renderShopCard(entry, idx) {
    const card = document.createElement('div');
    /* bought cards lose ALL content (icon/name/stats/price/buttons):
       only the empty box remains until the next reroll refills it */
    if (entry.sold) {
      card.className = 'shop-card emptied';
      return card;
    }
    /* affordability is shown on the card: a broke card dims and its
       price turns red (spec §7) */
    const afford = game.materials >= entry.price;
    card.className = 'shop-card' + (afford ? '' : ' cannot-afford');
    card.style.borderColor = KS.tierInfo(entry.tier).color;
    card.innerHTML = `
      ${entryTitleHtml(entry)}
      <div class="sc-stats">${entryStatsHtml(entry)}</div>
      <div class="sc-price${afford ? '' : ' cannot'}"><span class="mat-cube"></span> ${entry.price}</div>
      <button class="btn sc-buy" ${afford ? '' : 'data-broke="1"'}>${afford ? KS.t('buy') : KS.t('cannotAfford')}</button>
      <button class="lock-btn ${entry.locked ? 'on' : ''}">
        <span class="key-chip">E</span><span>${entry.locked ? KS.t('unlock') : KS.t('lock')}</span>
      </button>
    `;
    fillEntryIcon(card, entry);
    bindHoverSound(card);
    card.addEventListener('mouseenter', () => { hoveredShopIdx = idx; });
    card.addEventListener('mousemove', (e) =>
      showTooltip(entryTooltipHtml(entry), e.clientX, e.clientY));
    card.addEventListener('mouseleave', hideTooltip);

    const buy = card.querySelector('.sc-buy');
    bindBtn(buy, () => buyEntry(entry, card));
    const lock = card.querySelector('.lock-btn');
    bindBtn(lock, () => toggleLock(entry, card));
    return card;
  }

  function buyEntry(entry, card) {
    if (entry.sold) return;
    if (game.materials < entry.price) { toast(KS.t('needMaterials')); return; }
    if (entry.kind === 'weapon') {
      if (!game.buyWeapon(entry.id, entry.tier)) { toast(KS.t('weaponsFull')); return; }
    } else {
      game.buyItem(KS.Shop.itemDef(entry.id));
    }
    game.spendMaterials(entry.price);
    entry.sold = true;
    KS.Audio.clickSfx();
    refreshHudWeapon();
    renderShop();
  }

  function toggleLock(entry, card) {
    entry.locked = !entry.locked;
    const btn = card.querySelector('.lock-btn');
    btn.classList.toggle('on', entry.locked);
    btn.querySelector('span:last-child').textContent = entry.locked ? KS.t('unlock') : KS.t('lock');
  }

  function rerollShop() {
    const cost = shopRerollCost();
    if (cost > 0) {
      if (game.materials < cost) { toast(KS.t('needMaterials')); return; }
      game.spendMaterials(cost);
    }
    shopRerolls++;
    shopEntries = KS.Shop.roll(game.wave, game.stats.luck, shopEntries);
    lastShopEntries = shopEntries;
    renderShop();
  }

  function toggleLockHotkey() {
    if (!$('shop').classList.contains('visible')) return;
    const entry = shopEntries && shopEntries[hoveredShopIdx];
    if (!entry || entry.sold) return;
    const card = $('shop-cards').children[hoveredShopIdx];
    if (card) toggleLock(entry, card);
  }

  function renderOwnedDisplay() {
    /* items centered under the first 3 slots, weapons under the 4th */
    const items = $('shop-owned-items');
    items.innerHTML = '';
    for (const item of game.ownedItems) {
      const el = document.createElement('div');
      el.className = 'owned-chip';
      el.style.borderColor = KS.tierInfo(item.tier).color;
      el.appendChild(makeIcon(`assets/items/${item.id}.png`, item.icon));
      el.addEventListener('mousemove', (e) => showTooltip(itemTooltipHtml(item), e.clientX, e.clientY));
      el.addEventListener('mouseleave', hideTooltip);
      items.appendChild(el);
    }
    if (!game.ownedItems.length) items.innerHTML = '<span class="owned-empty">—</span>';

    const weapons = $('shop-owned-weapons');
    weapons.innerHTML = '';
    game.weapons.forEach((w, idx) => {
      const el = document.createElement('div');
      el.className = 'owned-chip';
      el.style.borderColor = KS.tierInfo(w.tier).color;
      el.innerHTML = `<img src="${w.def.icon}" alt="${KS.L(w.def.name)}">`;
      el.addEventListener('mousemove', (e) => showTooltip(weaponTooltipHtml(w.def, w.tier), e.clientX, e.clientY));
      el.addEventListener('mouseleave', hideTooltip);
      /* click an owned weapon to sell it or combine duplicates */
      bindBtn(el, () => openWeaponManage(idx));
      weapons.appendChild(el);
    });
  }

  /* ---------------- sell / combine owned weapons ---------------- */
  let wmIndex = -1;

  function openWeaponManage(idx) {
    const w = game.weapons[idx];
    if (!w) return;
    wmIndex = idx;
    const info = KS.tierInfo(w.tier);
    $('wm-icon').innerHTML = `<img src="${w.def.icon}" alt="">`;
    $('wm-icon').style.borderColor = info.color;
    $('wm-name').textContent = w.def.name;
    $('wm-name').style.color = info.color;
    $('wm-tier').textContent = `T${w.tier} · ${info.name}`;
    $('wm-tier').style.color = info.color;
    renderStatLines($('wm-stats'), weaponStatLines(w.def, w.tier));

    const sellBtn = $('btn-wm-sell');
    const comBtn = $('btn-wm-combine');
    const canSell = game.weapons.length > 1;
    sellBtn.disabled = !canSell;
    sellBtn.innerHTML = `<span class="mat-cube"></span> ${KS.t('sell')} +${KS.Shop.weaponSellPrice(w.def.id, w.tier)}`;

    const copies = game.weapons.filter((x) => x.def.id === w.def.id && x.tier === w.tier).length;
    const canCombine = copies >= 2 && w.tier < 4;
    comBtn.disabled = !canCombine;
    comBtn.textContent = canCombine
      ? `${KS.t('combine')} → T${w.tier + 1}`
      : KS.t('combine');

    /* hint line: why the action is unavailable */
    let hint = '';
    if (!canSell) hint = KS.t('lastWeapon');
    else if (!canCombine) {
      hint = (w.tier >= 4 && copies >= 2) ? KS.t('maxTier') : KS.t('combineNeed');
    }
    $('wm-hint').textContent = hint;

    hideTooltip();
    $('wep-manage').classList.remove('hidden');
  }

  function closeWeaponManage() {
    wmIndex = -1;
    $('wep-manage').classList.add('hidden');
  }

  function sellWeapon() {
    const idx = wmIndex;
    if (idx < 0 || !game.weapons[idx]) return;
    if (game.weapons.length <= 1) { toast(KS.t('lastWeapon')); return; }
    const gained = game.sellWeapon(idx);
    if (gained > 0) {
      KS.Audio.clickSfx();
      closeWeaponManage();
      refreshHudWeapon();
      renderShop();
    }
  }

  function combineWeapon() {
    const idx = wmIndex;
    if (idx < 0) return;
    if (game.combineWeapon(idx)) {
      KS.Audio.clickSfx();
      closeWeaponManage();
      refreshHudWeapon();
      renderShop();
    }
  }

  /* (the per-instance refreshHudWeapon above is the only implementation —
     its signature guard makes shop-time calls cheap no-ops) */

  function goNextWave() {
    closeWeaponManage();
    hideTooltip();
    $('shop').classList.remove('visible');
    $('hud').classList.remove('dimmed');
    game.startWave(game.wave + 1);
  }

  /* =========================================================
     HUD binding
     ========================================================= */
  function bindHud() {
    game.onHUD = (h) => {
      const ratio = h.hp / h.maxHP;
      $('hp-fill').style.width = (ratio * 100) + '%';
      $('hp-fill').classList.toggle('low', ratio < 0.3);
      $('hp-text').textContent = `${Math.ceil(h.hp)} / ${h.maxHP}`;

      const t = Math.ceil(h.waveTimeLeft);
      if (t !== lastTimerSec) { $('timer').textContent = String(t); lastTimerSec = t; }
      if (h.kills !== lastKills) { $('kills').textContent = '☠ ' + h.kills; lastKills = h.kills; }
      if (h.materials !== lastMaterials) {
        $('materials-n').textContent = String(h.materials);
        lastMaterials = h.materials;
      }
      if (h.wave !== lastWave) {
        $('wave-label').textContent = `${KS.t('wave')} ${h.wave}` + (h.endless && h.wave > C.WAVES.length ? ' · ' + KS.t('endless') : '');
        lastWave = h.wave;
      }
      /* per-instance cooldown overlays (spec §10) */
      refreshHudWeapon();
      const cdMap = h.weapons || [];
      document.querySelectorAll('#weapon-slot .weapon-cd').forEach((el) => {
        const inst = cdMap.find((x) => x.uid === Number(el.dataset.uid));
        if (inst) el.style.height = ((1 - inst.cdFill) * 100) + '%';
      });

      /* boss health bars (one segment per boss, separate HP) */
      const bb = $('bossbar');
      if (h.bosses && h.bosses.length) {
        bb.classList.remove('hidden');
        const name = h.bosses.length > 1 ? 'AI COUNCIL' : h.bosses[0].name;
        if ($('bossbar-name').textContent !== name) $('bossbar-name').textContent = name;
        const bars = h.bosses.map((b) => {
          const pct = Math.max(0, Math.min(100, (b.hp / b.maxHP) * 100));
          return `<div class="bossbar-seg"><div class="bossbar-fill" style="width:${pct}%"></div></div>`;
        }).join('');
        if ($('bossbar-bars').innerHTML !== bars) $('bossbar-bars').innerHTML = bars;
      } else {
        bb.classList.add('hidden');
      }

      /* debugging display — toggle with B during a run */
      if (debugOn) {
        const panel = $('debugpanel');
        const txt = game.debugData();
        if (panel.textContent !== txt) panel.textContent = txt;
        panel.classList.remove('hidden');
      } else {
        $('debugpanel').classList.add('hidden');
      }
    };

    game.onRunEnd = (st) => {
      const canRetryWave = !st.won && KS.Settings.get().retryFailedWaves;
      if (st.won) {
        KS.Records.addWin(currentChar.id, st.difficulty);
        $('go-title').textContent = KS.t('youSurvived');
        $('go-title').classList.remove('dead');
        $('go-title').classList.add('won');
        $('btn-continue').classList.remove('hidden');
      } else {
        KS.Records.addDeath(currentChar.id, st.wave, st.endless);
        $('go-title').textContent = KS.t('youDied');
        $('go-title').classList.add('dead');
        $('go-title').classList.remove('won');
        $('btn-continue').classList.add('hidden');
      }
      $('btn-retry-wave').classList.toggle('hidden', !canRetryWave);
      $('btn-retry').classList.toggle('hidden', canRetryWave);
      $('go-time').textContent = fmtTime(st.time);
      $('go-kills').textContent = String(st.kills);
      $('go-wave').textContent = String(st.wave) + (st.endless ? ' (Endless)' : '');
      setTimeout(() => $('gameover').classList.add('visible'), 450);
    };

    game.onWaveComplete = onWaveComplete;
  }

  /* =========================================================
     Boot
     ========================================================= */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('failed to load ' + src));
      img.src = src;
    });
  }

  async function boot() {
    try {
      KS.applyI18n();
      KS.Settings.apply('all');

      /* every playable character's portrait is preloaded so the
         in-game player sprite matches the selected character */
      const entries = Object.entries(ASSETS)
        .concat(Object.entries(C.CHARACTERS).map(([id, ch]) => ['char_' + id, ch.portrait]));
      const loaded = await Promise.all(entries.map(([, src]) => loadImage(src)));
      const imgs = Object.fromEntries(entries.map(([k], i) => [k, loaded[i]]));
      for (const id of Object.keys(C.CHARACTERS)) {
        charPortraits[id] = imgs['char_' + id] || imgs.portrait;
      }

      /* Builder's Turret art per tier (spec §9): KS.Turret.images */
      KS.Turret.images = {
        T1: imgs.turretT1, T2: imgs.turretT2,
        T3: imgs.turretT3, T4: imgs.turretT4,
      };

      game = new KS.Game($('game'), {
        map: imgs.map, portrait: imgs.portrait, fist: imgs.fist,
        hand: imgs.hand, knife: imgs.knife,
        enemy: {
          iphone: imgs.eIphone, camera: imgs.eCamera, chatgpt: imgs.eChatgpt,
          toilet: imgs.eToilet, gemini: imgs.eGemini, tiktok: imgs.eTiktok,
          claude: imgs.eClaude, drugs: imgs.eDrugs,
        },
      });
      bindHud();
      buildRunOptions();
      buildSettings();
      /* hidden dev console (only reachable while the Dev Mode toggle is
         enabled, which itself only shows while Hebrew is selected) */
      KS.DevMode.init({ getGame: () => game });

      /* menu */
      bindBtn($('btn-start'), showCharacters);
      bindBtn($('btn-settings'), showSettings);
      bindBtn($('btn-settings-back'), showMenu);

      /* back buttons */
      bindBtn($('btn-chars-back'), showMenu);
      bindBtn($('btn-weapons-back'), showCharacters);
      bindBtn($('btn-diff-back'), showWeapons);

      /* pause buttons */
      bindBtn($('btn-resume'), () => setPaused(false));
      bindBtn($('btn-restart'), () => askConfirm('restart'));
      bindBtn($('btn-endrun'), () => askConfirm('end'));
      bindBtn($('btn-quit'), () => askConfirm('quit'));
      bindBtn($('btn-confirm-yes'), doConfirm);
      bindBtn($('btn-confirm-no'), closeConfirm);
      bindBtn($('btn-stats-toggle'), () => {
        statsTab = statsTab === 'primary' ? 'secondary' : 'primary';
        $('btn-stats-toggle').textContent = statsTab === 'primary' ? 'Secondary ▸' : '◂ Primary';
        renderStatsList($('pm-stats-list'), game.snapshot());
      });

      /* break screens */
      bindBtn($('btn-lu-reroll'), rerollLevelUp);
      bindBtn($('btn-cr-take'), () => finishOneCrate(true));
      bindBtn($('btn-cr-recycle'), () => finishOneCrate(false));
      bindBtn($('btn-shop-reroll'), rerollShop);
      bindBtn($('btn-shop-go'), goNextWave);

      /* weapon sell / combine popup */
      bindBtn($('btn-wm-sell'), sellWeapon);
      bindBtn($('btn-wm-combine'), combineWeapon);
      bindBtn($('btn-wm-close'), closeWeaponManage);
      $('wep-manage').addEventListener('click', (e) => {
        if (e.target === $('wep-manage')) closeWeaponManage();
      });

      /* game over buttons */
      bindBtn($('btn-retry'), () => startRun());
      bindBtn($('btn-retry-wave'), () => {
        $('gameover').classList.remove('visible');
        $('hud').classList.remove('dimmed');
        game.retryWave();
      });
      bindBtn($('btn-continue'), () => {
        $('gameover').classList.remove('visible');
        game.continueEndless();
      });
      bindBtn($('btn-go-endrun'), () => {
        game.stop();
        showCharacters();
        KS.Audio.restartMusic();
      });
      bindBtn($('btn-go-menu'), () => {
        game.stop();
        showMenu();
        KS.Audio.restartMusic();
      });

      /* hotkeys: F = level-up reroll, R = shop reroll, E = shop lock */
      KS.Input.setHotkey('KeyF', () => {
        if ($('levelup').classList.contains('visible')) rerollLevelUp();
      });
      KS.Input.setHotkey('KeyR', () => {
        if ($('shop').classList.contains('visible')) rerollShop();
      });
      KS.Input.setHotkey('KeyE', toggleLockHotkey);
      /* B toggles the enemy-system debugging overlay (wave, quotas,
         active enemies, variants, boss HP, spawn queue) */
      KS.Input.setHotkey('KeyB', () => { debugOn = !debugOn; });

      KS.Input.setPauseHandler(() => {
        /* ESC first closes the weapon sell/combine popup */
        if (!$('wep-manage').classList.contains('hidden')) { closeWeaponManage(); return; }
        if (paused && confirmAction) { closeConfirm(); return; }
        setPaused(!paused);
      });
      window.addEventListener('blur', () => {
        if (game && game.running && !game.over && game.state === 'wave') setPaused(true);
      });

      KS.Audio.startMusic();

      window.KSDBG = {
        get game() { return game; },
        get state() { return { currentChar, currentWeaponId, currentDifficulty, runSettings, paused, statsTab }; },
        startRun,
        showCharacters,
        openShop,
        openLevelUp,
      };

      $('btn-start').disabled = false;
      $('btn-start').textContent = KS.t('start');
    } catch (err) {
      console.error(err);
      $('btn-start').textContent = 'ERROR';
    }
  }

  boot();
})();
