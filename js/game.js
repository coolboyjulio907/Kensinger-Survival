/* =========================================================
   Core game: loop, camera, wave clock, combat, rendering.
   - Larger-than-screen 3x3 arena with camera follow.
   - Weapons: array (up to MAX_WEAPONS), each auto-attacks on
     its own cooldown. Strikes LOCK their direction on fire,
     fly dead straight out-and-back and hit EVERY enemy they
     touch (infinite piercing).
   - Enemy system (see enemies.js): nine enemy identities with
     per-type AI, Standard/Advanced/Elite variants, boss waves
     (ChatGPT 5 / Gemini 10 / Claude 15 / AI Council 20) and a
     quota-based spawn director with red-X warnings.
   - EVERY killed enemy drops materials (reward by type/variant/
     boss); picking a material up grants +1 material AND +1 XP.
   - New waves: full heal + player teleports to map center.
   - Wave end: enemies clear, drops auto-collect, then the
     WAVE COMPLETED -> Level Up -> Shop intermission runs.
     Boss waves hold open until every boss is defeated.
   ========================================================= */
window.KS = window.KS || {};
(function () {
  const C = KS.CONFIG;
  const ARENA = KS.arenaSize();
  const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
  const TAU = Math.PI * 2;

  class Game {
    constructor(canvas, images) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.images = images;
      if (images.enemy) KS.EnemySprites.init(images.enemy);
      this.running = false;
      this.over = false;
      this.paused = false;
      this.state = 'idle';           // 'wave' | 'break' | 'idle'
      this.onHUD = null;
      this.onRunEnd = null;
      this.onWaveComplete = null;    // (waveJustEnded) => main shows banner/levelup/shop
      this.camX = 0; this.camY = 0;
      this._lastFrame = 0;

      this.prerenderArena();
      window.addEventListener('resize', () => this.resize());
      this.resize();
      this.rafId = requestAnimationFrame((t) => { this.last = t; this.loop(t); });
    }

    /* ---------------- lifecycle ---------------- */
    start(charDef, opts = {}) {
      this.charDef = charDef;
      this.opts = opts;
      /* per-run player sprite: the selected character's portrait */
      if (opts.portrait) this.images.portrait = opts.portrait;
      this.difficulty = opts.difficulty || 0;
      this.mods = (C.DIFFICULTIES[this.difficulty] || C.DIFFICULTIES[0]).mods || {};
      this.endless = !!opts.endless;
      this.stats = Object.assign({}, charDef.stats);   // mutable run stats
      this.player = new KS.Player(this.stats);
      const wid = opts.weaponId || charDef.startingWeapon;
      /* ---- weapon INSTANCES (spec §10) ----
         Every slot is an independent instance with a unique id: defs
         (C.WEAPONS) hold shared data; instances hold tier/cooldown/
         state. Identical weapons never merge. */
      this.nextWeaponUid = 1;
      this.weapons = [
        this.mkWeapon(wid || charDef.startingWeapon, charDef.startingWeaponTier),
      ];
      /* Brotato Brawler/Crazy structure (spec §3-§4): the chosen
         starting weapon PLUS one guaranteed bonus weapon as a separate
         instance — even when the chosen weapon is the same kind */
      if (charDef.bonusWeapon) {
        this.weapons.push(this.mkWeapon(charDef.bonusWeapon, 1));
      }
      /* Bair The Builder: exactly one unique Builder's Turret
         (spec §8) — recreated each wave near the arena center */
      this.builderTurret = !!charDef.turret;
      this.turret = null;
      this.enemies = [];
      this.strikes = [];
      this.dmgNums = [];
      this.dying = [];
      this.markers = [];             // red X spawn warnings
      this.drops = [];               // material pickups
      this.eprojs = [];              // enemy projectiles
      this.hazards = [];             // flush waves / soundwaves / clouds / zones
      this.bosses = [];              // active boss references
      this.bossBanner = null;        // boss name shown under the wave banner
      this.bossBannerT = 0;
      this.pairSeq = 0;
      this.director = new KS.SpawnDirector(this);
      this.ownedItems = [];          // bought item defs
      this.crates = [];              // loot crates collected, resolved at wave end
      this.materials = 0;            // starts at 0 every run (spec §2)
      this.level = this.stats.level || 1;
      this.xp = 0;
      this.pendingLevels = 0;
      this.harvestMul = 1;           // harvesting growth rule
      this.time = 0;
      this.kills = 0;
      this.wave = 0;
      this.shakeT = 0;
      this.waveFlash = 0;
      this.over = false;
      this.won = false;
      this.paused = false;
      this.running = true;
      this.last = performance.now();
      this.startWave(1);
    }

    stop() { this.running = false; }

    startWave(n) {
      this.wave = n;
      this.waveTime = KS.waveDuration(n);
      this.waveBannerT = 2.2;
      this.enemies = [];
      this.markers = [];
      this.drops = [];
      this.eprojs = [];
      this.hazards = [];
      this.bosses = [];
      this.bossBanner = null;
      this.bossBannerT = 0;
      this.state = 'wave';
      this.over = false;
      this.won = false;                // clear any stale victory flag
      this.paused = false;
      /* Builder's Turret: one unique structure, re-deployed at the
         start of every wave near the arena center (spec §9) */
      this.turret = this.builderTurret ? new KS.Turret(this) : null;
      /* quota-based spawn schedule for this wave (enemies + bosses) */
      this.director.startWave(n);
      this.waveQuotaUnits = this.director.totalUnits();   // horde-wave loot rule
      this.cratesDropped = 0;        // ordinary crates spawned this wave (spec §4)
      /* moving onto a new wave: full heal + back to the center of the map */
      if (this.player) {
        const a = KS.arenaSize();
        this.player.x = a / 2;
        this.player.y = a / 2;
        this.player.hp = this.player.maxHP;
        this.player.invuln = 0;
        this.player.regenAcc = 0;
        this.snapCamera();
      }
      /* snapshot for the "Retry failed waves" setting */
      this.waveSnap = {
        wave: n,
        stats: Object.assign({}, this.stats),
        materials: this.materials,
        level: this.level,
        xp: this.xp,
        harvestMul: this.harvestMul,
        weapons: this.weapons.map((w) => ({ id: w.def.id, tier: w.tier })),
        items: this.ownedItems.map((it) => it.id),
        crates: this.crates.map((c) => ({ special: !!c.special })),
      };
      this.last = performance.now();
    }

    retryWave() {
      const s = this.waveSnap;
      if (!s) { this.startWave(this.wave); return; }
      this.stats = Object.assign({}, s.stats);
      this.player = new KS.Player(this.stats);
      this.materials = s.materials;
      this.level = s.level;
      this.xp = s.xp;
      this.harvestMul = s.harvestMul;
      this.weapons = s.weapons.map((w) => ({
        def: C.WEAPONS[w.id], tier: w.tier, timer: 0,
      }));
      this.ownedItems = s.items.map((id) => KS.Shop.itemDef(id)).filter(Boolean);
      this.crates = (s.crates || []).filter((c) => c && typeof c === 'object');
      this.over = false;
      this.won = false;
      this.startWave(s.wave);
    }

    continueEndless() {
      if (!this.running) return;
      this.endless = true;
      this.over = false;
      this.won = false;
      this.startWave(this.wave + 1);
    }

    /* ---------------- arena pre-render ---------------- */
    prerenderArena() {
      const TILE = C.ARENA.TILE, N = C.ARENA.GRID;
      const cv = document.createElement('canvas');
      cv.width = cv.height = ARENA;
      const g = cv.getContext('2d');

      for (let row = 0; row < N; row++)
        for (let col = 0; col < N; col++)
          g.drawImage(this.images.map, col * TILE, row * TILE, TILE, TILE);

      g.strokeStyle = 'rgba(0, 0, 0, 0.14)';
      g.lineWidth = 2;
      for (let i = 1; i < N; i++) {
        g.beginPath(); g.moveTo(i * TILE, 0); g.lineTo(i * TILE, ARENA); g.stroke();
        g.beginPath(); g.moveTo(0, i * TILE); g.lineTo(ARENA, i * TILE); g.stroke();
      }

      const edge = 46;
      const grads = [
        [0, 0, 0, edge], [0, ARENA, 0, ARENA - edge],
        [0, 0, edge, 0], [ARENA, 0, ARENA - edge, 0],
      ];
      for (const [x0, y0, x1, y1] of grads) {
        const gr = g.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, 'rgba(0,0,0,0.30)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, ARENA, ARENA);
      }
      this.arenaCv = cv;
    }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.dpr = dpr;
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
      this.canvas.width = Math.round(this.vw * dpr);
      this.canvas.height = Math.round(this.vh * dpr);
      this.canvas.style.width = this.vw + 'px';
      this.canvas.style.height = this.vh + 'px';
    }

    computeView() {
      const frac = C.VIEW.visibleFrac;
      const scale = Math.max(this.vw, this.vh) / (ARENA * frac);
      return {
        scale,
        vw2: this.vw / scale,
        vh2: this.vh / scale,
      };
    }

    /* jump the camera straight to the player (no long pan across the map) */
    snapCamera() {
      if (!this.player) return;
      const { vw2, vh2 } = this.computeView();
      this.camX = Math.min(Math.max(this.player.x - vw2 / 2, 0), Math.max(0, ARENA - vw2));
      this.camY = Math.min(Math.max(this.player.y - vh2 / 2, 0), Math.max(0, ARENA - vh2));
    }

    mouseWorld() {
      const { scale } = this.computeView();
      const m = KS.Input.mouse;
      return { x: m.x / scale + this.camX, y: m.y / scale + this.camY };
    }

    /* ---------------- main loop ---------------- */
    loop = (now) => {
      this.rafId = requestAnimationFrame(this.loop);
      /* optional 30 FPS cap (Limit FPS setting) */
      if (KS.Settings.get().limitFps && now - this._lastFrame < 33) return;
      const step = this._lastFrame ? now - this._lastFrame : 16.7;
      this._lastFrame = now;
      let dt = step / 1000;
      if (dt > 0.05) dt = 0.05;
      if (this.running && !this.paused && !this.over && this.state === 'wave') this.update(dt);
      else if (this.running && this.state === 'break') this.updateBreakFx(dt);
      this.render();
      if (this.onHUD && this.running) this.onHUD(this.hudData());
    };

    /* ---------------- attack helpers ---------------- */
    /* effective cooldown of a weapon (attack speed stat + character
       bonuses such as Adkins' +50% with Unarmed weapons) */
    weaponCooldown(w) {
      const tdef = w.def.tiers[w.tier];
      let mul = 1 + (this.stats.attackSpeed || 0) / 100;
      if (w.def.classes && w.def.classes.includes('Unarmed') && this.stats.unarmedAS) {
        mul *= 1 + this.stats.unarmedAS / 100;
      }
      return tdef.cooldown / mul;
    }

    /* passive stat fx a weapon grants while equipped (Hand: Harvesting) */
    weaponFx(w) {
      const tdef = w.def.tiers[w.tier];
      const fx = [];
      if (tdef.harvest) fx.push(['harvesting', tdef.harvest]);
      return fx;
    }
    applyWeaponFx(w, sign = 1) {
      for (const [key, val] of this.weaponFx(w)) {
        this.stats[key] = (this.stats[key] || 0) + val * sign;
      }
    }

    hudData() {
      /* longest-cooldown weapon drives the HUD fill */
      /* per-instance weapon snapshot (spec §10): each slot reports its
         own uid/icon/tier/cooldown — never merged by weapon name */
      const weapons = this.weapons.map((w) => ({
        uid: w.uid,
        icon: w.def.icon,
        tier: w.tier,
        cdFill: this.over ? 1 : Math.min(1, w.timer / this.weaponCooldown(w)),
      }));
      return {
        hp: Math.max(0, this.player.hp),
        maxHP: this.player.maxHP,
        time: this.time,
        kills: this.kills,
        materials: this.materials,
        level: this.level,
        wave: this.wave,
        waveTimeLeft: Math.max(0, this.waveTime),
        endless: this.endless,
        bosses: this.bossBars(),
        weapon: { cdFill: weapons.length ? weapons[0].cdFill : 1 },
        weapons,
      };
    }

    /* debugging display (spec §12): wave, quotas, active count,
       variants, boss health, spawn queue — rendered by main.js */
    debugData() {
      if (!this.director) return '';
      const rem = this.director.remaining();
      const spawned = this.director.spawned || {};
      const variants = { standard: 0, advanced: 0, elite: 0 };
      let ordinary = 0;
      for (const e of this.enemies) {
        if (e.dead || e.boss) continue;
        ordinary++;
        variants[e.variant.id] = (variants[e.variant.id] || 0) + 1;
      }
      const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(' ') || '—';
      const lines = [
        `WAVE ${this.wave}  (${Math.max(0, this.waveTime).toFixed(1)}s left)  state=${this.state}`,
        `active ordinary: ${ordinary}/${this.bossAlive() ? C.ENEMY.bossOrdinaryCap : C.ENEMY.maxAlive}` +
          ` (cap: ${this.bossAlive() ? 'BOSS ACTIVE' : 'normal'})  markers: ${this.markers.length}`,
        `variants alive — std ${variants.standard} · adv ${variants.advanced} · elite ${variants.elite}`,
        `spawn queue: ${this.director.queue.length} events · boss queue: ${this.director.bossQueue.length}`,
        `spawned:  ${fmt(spawned)}`,
        `quota left: ${fmt(rem)}`,
        `projectiles: ${this.eprojs.length}  hazards: ${this.hazards.length}`,
      ];
      for (const b of this.bosses) {
        lines.push(`BOSS ${b.bossCfg.name}: ${Math.max(0, Math.round(b.hp))}/${b.maxHP}` +
          ` (${(b.hp / b.maxHP * 100).toFixed(0)}%)  phase ${b.phase()}${b.dead ? '  DEAD' : ''}`);
      }
      return lines.join('\n');
    }

    /* ---------------- update (active wave) ---------------- */
    update(dt) {
      this.time += dt;
      const p = this.player;
      /* distraction clouds slow the player (strongest applies, never stacks) */
      p.update(dt, KS.cloudSlow(this.hazards, p));

      /* --- wave clock — when it expires the wave holds open until
         the field is clear (and any boss is dead): remaining enemies
         are DEFEATED by the player, never discarded (spec §4-§5) --- */
      this.waveTime -= dt;
      if (this.waveBannerT > 0) this.waveBannerT -= dt;
      if (this.bossBannerT > 0) this.bossBannerT -= dt;
      if (this.waveTime <= 0) {
        this.waveTime = 0;               // overtime: scheduling has stopped
        const leftover = this.enemies.some(e => !e.dead) || this.markers.length > 0;
        if (leftover || this.bossAlive()) {
          /* overtime — the player finishes the remaining enemies */
        } else {
          this.endWave();
          return;
        }
      }

      /* --- spawn markers -> enemies --- */
      for (const m of this.markers) m.t -= dt;
      for (let i = this.markers.length - 1; i >= 0; i--) {
        if (this.markers[i].t <= 0) {
          this.enemies.push(this.markers[i].enemy);
          this.markers.splice(i, 1);
        }
      }

      /* --- spawn director: quota schedule + boss entrances --- */
      this.director.update(dt);

      /* --- enemies: per-type AI + contact damage --- */
      for (const e of this.enemies) {
        if (e.dead) continue;
        e.update(dt, this);
        if (e.spawnT > 0 || e.dmg <= 0) continue;    // harmless while spawning in / contactless
        const dx = p.x - e.x, dy = p.y - e.y;
        if (Math.hypot(dx, dy) < p.r + e.r) {
          const res = p.hurt(e.dmg);
          if (res === 'dodge') {
            this.pushDmg(p.x, p.y - p.r - 10, 'DODGE', false);
          } else if (res === 'hit') {
            if (KS.Settings.get().screenshake) this.shakeT = C.FX.shakeTime;
            if (p.hp <= 0 && !this.over) { this.defeat(); return; }
          }
        }
      }

      /* --- enemy projectiles: move + hit the player --- */
      for (const pr of this.eprojs) {
        pr.update(dt);
        if (pr.dead) continue;
        if (Math.hypot(p.x - pr.x, p.y - pr.y) < p.r + pr.r) {
          pr.dead = true;
          const res = p.hurt(pr.dmg);
          if (res === 'dodge') {
            this.pushDmg(p.x, p.y - p.r - 10, 'DODGE', false);
          } else if (res === 'hit') {
            if (KS.Settings.get().screenshake) this.shakeT = C.FX.shakeTime;
            if (p.hp <= 0 && !this.over) { this.defeat(); return; }
          }
        }
      }
      /* splitting orbs burst into a radial cluster on expiry */
      for (const pr of this.eprojs) {
        if (pr.dead && pr.split > 0) {
          for (let i = 0; i < pr.split; i++) {
            this.eprojs.push(new KS.EProj(pr.x, pr.y,
              i * TAU / pr.split + Math.random() * 0.4, 210, pr.dmg, 'text',
              { r: 6, life: 2.2 }));
          }
          pr.split = 0;
        }
      }
      this.eprojs = this.eprojs.filter(pr => !pr.dead);

      /* --- hazards: flush waves / soundwaves / clouds / zones --- */
      KS.updateHazards(this.hazards, dt, this);

      /* Builder's Turret: auto-targets, aims and fires on its own
         cooldown; stats refresh with the player's (spec §9) */
      if (this.turret) this.turret.update(dt);

      /* --- weapons: fully automatic attacks (spec §7) ---
         Manual clicking is disabled as a combat input: every weapon
         instance fires on its own cooldown, only when a real enemy is
         in reach. Mouse input stays UI-only. */
      for (const w of this.weapons) {
        w.timer += dt;
        if (w.timer >= this.weaponCooldown(w)) {
          if (this.nearestEnemy(p, this.weaponReach(w))) {
            w.timer = 0;
            this.doStrike(p, w);
          }
        }
      }
      for (const s of this.strikes) {
        s.update(dt);
        this.applyStrikeHits(p, s);
      }

      /* --- material drops --- */
      this.updateDrops(dt);

      /* --- fx lists --- */
      for (const n of this.dmgNums) n.update(dt);
      for (const d of this.dying) d.t += dt;

      this.strikes = this.strikes.filter(s => !s.dead);
      this.dmgNums = this.dmgNums.filter(n => !n.dead);
      this.dying = this.dying.filter(d => d.t < 0.3);
      this.enemies = this.enemies.filter(e => !e.dead);

      if (this.shakeT > 0) this.shakeT -= dt;
      if (this.waveFlash > 0) this.waveFlash -= dt;
    }

    /* break-state fx: damage numbers drift away, drop fly-in */
    updateBreakFx(dt) {
      for (const n of this.dmgNums) n.update(dt);
      this.dmgNums = this.dmgNums.filter(n => !n.dead);
      for (const s of this.strikes) s.update(dt);
      this.strikes = this.strikes.filter(s => !s.dead);
      this.updateDrops(dt, true);
    }

    updateDrops(dt, collectAll = false) {
      const p = this.player;
      const magnet = 80 + (this.stats.pickupRange || 0) * 0.6;
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        d.t += dt;
        const dx = p.x - d.x, dy = p.y - d.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (collectAll || dist < magnet) {
          const sp = collectAll ? 900 : Math.max(240, 900 - dist * 2);
          d.x += (dx / dist) * sp * dt;
          d.y += (dy / dist) * sp * dt;
        }
        if (collectAll || dist < p.r + 12) {
          if (d.type === 'fruit') {
            /* fruit heals (spec §4): base 3 + % Consumable Heal */
            const heal = C.LOOT.fruitHeal + (this.stats.consumableHeal || 0);
            const before = p.hp;
            p.hp = Math.min(p.maxHP, p.hp + heal);
            this.pushDmg(p.x, p.y - p.r - 12, `+${Math.round(p.hp - before)} HP`, false);
            KS.Audio.pickupSfx();
          } else if (d.type === 'crate') {
            /* register for the end-of-wave reward screen (spec §4) */
            this.crates.push({ special: !!d.special });
            KS.Audio.pickupSfx();
          } else {
            /* each picked-up material grants +1 material AND bulk XP:
               1 XP per material (scaled by % XP Gain) */
            this.materials += d.val;
            this.gainXP(Math.max(1,
              Math.round(d.val * (1 + (this.stats.xpGain || 0) / 100))));
            KS.Audio.pickupSfx();
          }
          this.drops.splice(i, 1);
        }
      }
    }

    pushDmg(x, y, val, crit) {
      if (!KS.Settings.get().damageDisplay && typeof val === 'number') return;
      this.dmgNums.push(new KS.DamageNumber(x, y, val, crit));
    }

    weaponReach(w) {
      return (w.def.range + (this.stats.range || 0) * 0.5) * C.MELEE_RANGE_SCALE;
    }

    /* ---------------- spawning ---------------- */
    /* pick an arena-edge spot at least minDist from the player;
       never inside the arena center where the principal walks */
    spawnSpot(minDist = C.ENEMY.minSpawnDist) {
      const a = KS.arenaSize(), m = C.ENEMY.edgeMargin;
      const p = this.player;
      let best = null, bestD = -1;
      for (let i = 0; i < 14; i++) {
        const side = (Math.random() * 4) | 0;
        let x, y;
        if (side === 0)      { x = m + Math.random() * (a - m * 2); y = m; }
        else if (side === 1) { x = a - m; y = m + Math.random() * (a - m * 2); }
        else if (side === 2) { x = m + Math.random() * (a - m * 2); y = a - m; }
        else                 { x = m; y = m + Math.random() * (a - m * 2); }
        const d = p ? Math.hypot(x - p.x, y - p.y) : Infinity;
        if (d >= minDist) return { x, y };
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
      return best;                       // farthest candidate (no cheating)
    }

    /* one quota spawn event: red X warning, then the enemy appears.
       AirPods: one event = one PAIR (two independently targetable pods). */
    queueEnemySpawn(type) {
      const def = C.ENEMIES[type];
      const variant = KS.SpawnDirector.rollVariant(this.wave);
      /* safety valve: if past the active cap, a random ordinary enemy
         is sacrificed without loot or kill credit */
      const alive = this.enemies.reduce((n, e) => n + (!e.dead && !e.boss ? 1 : 0), 0);
      const cap = this.bossAlive() ? C.ENEMY.bossOrdinaryCap : C.ENEMY.maxAlive;
      if (alive >= cap) {
        const victims = this.enemies.filter(e => !e.dead && !e.boss && e.spawnT <= 0);
        if (victims.length) {
          const v = victims[(Math.random() * victims.length) | 0];
          v.dead = true;
          v.sacrificed = true;
          this.dying.push({ x: v.x, y: v.y, r: v.r, color: v.color, t: 0 });
        }
      }
      if (def.pair) {
        const s1 = this.spawnSpot(), s2 = this.spawnSpot();
        const pairId = ++this.pairSeq;
        const a = new KS.Enemy(type, variant, this, s1.x, s1.y, { pairId, pairSlot: 0 });
        const b = new KS.Enemy(type, variant, this, s2.x, s2.y, { pairId, pairSlot: 1 });
        a.partner = b; b.partner = a;
        this.markers.push({ x: s1.x, y: s1.y, t: C.ENEMY.markerTime, enemy: a });
        this.markers.push({ x: s2.x, y: s2.y, t: C.ENEMY.markerTime, enemy: b });
      } else {
        const s = this.spawnSpot();
        const e = new KS.Enemy(type, variant, this, s.x, s.y);
        this.markers.push({ x: s.x, y: s.y, t: C.ENEMY.markerTime, enemy: e });
      }
    }

    /* boss entrance: teleport-in animation + roar + name banner.
       Bosses bypass the ordinary-enemy cap. */
    spawnBoss(cfg) {
      const s = this.spawnSpot(320);
      const b = new KS.Enemy(cfg.base, 'standard', this, s.x, s.y, { boss: cfg });
      this.enemies.push(b);
      this.bosses.push(b);
      this.bossBanner = cfg.name;
      this.bossBannerT = 3.4;
      if (KS.Settings.get().screenshake) this.shakeT = C.FX.shakeTime * 2;
      KS.Audio.abilitySfx('bossRoar');
    }

    bossAlive() {
      return this.bosses.some(b => !b.dead);
    }

    /* data for the boss health bars (main.js renders them) */
    bossBars() {
      return this.bosses
        .filter(b => !b.dead)
        .map(b => ({ name: b.bossCfg.name, hp: Math.max(0, b.hp), maxHP: b.maxHP }));
    }

    nearestEnemy(p, range) {
      let best = null, bd = Infinity;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r;
        if (d <= range && d < bd) { bd = d; best = e; }
      }
      return best;
    }

    /* damage/knockback for every enemy the strike tip touches.
       Infinite piercing: the strike never stops, each enemy is
       damaged at most once per swing. */
    applyStrikeHits(p, s) {
      if (s.dead) return;
      const pos = s.pos();
      for (const e of this.enemies) {
        if (e.dead || e.spawnT > 0 || s.hits.has(e)) continue;
        if (Math.hypot(e.x - pos.x, e.y - pos.y) > e.r + s.hitR) continue;
        s.hits.add(e);
        const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        const died = e.hit(s.dmg, s.dirX * s.kb, s.dirY * s.kb, this);
        this.pushDmg(e.x, e.y - e.r - 6, s.dmg, s.crit);
        if (!s.stole && p.tryLifesteal()) {
          s.stole = true;
          this.pushDmg(p.x, p.y - p.r - 12, '+1', false);
        }
        if (died) this.onKill(e);
      }
    }

    /* fire a strike: the direction is LOCKED here and the strike
       then flies dead straight. Auto mode aims at the nearest
       enemy; manual aim aims at the cursor — but the travel
       distance is ALWAYS clamped to the weapon reach, so the
       weapon can never fly to a far-away click point. */
    doStrike(p, w) {
      const tdef = w.def.tiers[w.tier];
      const stats = this.stats;
      const reach = this.weaponReach(w);

      /* direction: always toward the nearest valid target — the
         mouse is never part of combat (spec §7) */
      let dirX, dirY;
      const target = this.nearestEnemy(p, reach);
      if (!target) return;
      const dx = target.x - p.x, dy = target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      dirX = dx / d; dirY = dy / d;

      const crit = Math.random() < w.def.critChance + (stats.critChance || 0) / 100;
      const scalingPct = w.def.scalingPct == null ? 100 : w.def.scalingPct;
      let dmg = tdef.damage
        * (1 + (stats[w.def.scalingStat] || 0) / 100 * scalingPct / 100)
        * (1 + (stats.damage || 0) / 100);
      if (crit) dmg *= w.def.critMult;

      const kb = (w.def.knockback + (stats.knockback || 0)) * C.FX.knockbackScale;
      this.strikes.push(new KS.Strike(p.x, p.y, dirX, dirY, reach, {
        dmg, crit, kb, hitR: 16,
        /* per-instance visual: each weapon uses its own attack art
           (fistAttack / handAttack / knifeAttack) */
        img: this.images[w.def.id] || this.images.fist,
        size: w.def.id === 'fist' ? 44 : 40,
      }));
      KS.Audio.punchSfx();
    }

    spawnPickup(e, type, special = false) {
      const a = Math.random() * Math.PI * 2;
      this.drops.push({
        x: e.x + Math.cos(a) * 8, y: e.y + Math.sin(a) * 8,
        t: Math.random() * 3, val: 0, type, special,
      });
    }

    onKill(e) {
      this.kills++;
      /* loot roll (spec §3-§5): wave-scaled material chance with a
         probabilistic fractional value, then an independent consumable
         roll (fruit vs diminishing crate). Bosses bypass the chances. */
      const loot = KS.Loot.rollForKill(this, e);
      if (loot.mats > 0) {
        /* split into a few visual cubes; near the pickup cap, values
           merge into existing pickups instead of adding objects */
        let val = loot.mats;
        const cap = C.LOOT.maxMatPickups;
        const matsOnGround = this.drops.filter((d) => d.type === 'mat').length;
        if (matsOnGround >= cap && this.drops.some((d) => d.type === 'mat')) {
          const target = this.drops.find((d) => d.type === 'mat');
          target.val += val;
        } else {
          const cubes = Math.max(1, Math.min(4, Math.round(val / 3)));
          const per = Math.max(1, Math.floor(val / cubes));
          let left = val;
          for (let i = 0; i < cubes && left > 0; i++) {
            const v = i === cubes - 1 ? left : Math.min(left, per);
            left -= v;
            const a = Math.random() * Math.PI * 2;
            this.drops.push({
              x: e.x + Math.cos(a) * 8, y: e.y + Math.sin(a) * 8,
              t: Math.random() * 3, val: v, type: 'mat',
            });
          }
        }
      }
      if (loot.fruit) this.spawnPickup(e, 'fruit');
      if (loot.crate) {
        this.spawnPickup(e, 'crate');
        this.cratesDropped++;          // diminishing: ordinary crates only
      }
      if (e.boss) {
        /* guaranteed boss reward (spec §5): never suppressed by the
           ordinary drop-rate rules */
        if (C.LOOT.bossCrateGuarantee) this.spawnPickup(e, 'crate', true);
        /* boss death: dark explosion feel + sound */
        if (KS.Settings.get().screenshake) this.shakeT = C.FX.shakeTime * 2;
        KS.Audio.abilitySfx('bossDie');
      }
    }

    gainXP(amount) {
      this.xp += amount;
      while (this.xp >= this.xpNeed()) {
        this.xp -= this.xpNeed();
        this.level++;
        this.pendingLevels++;
      }
    }

    xpNeed() {
      /* level n -> n+1 costs (n+3)^2 - 3 XP */
      return (this.level + 3) * (this.level + 3) - 3;
    }

    /* ---------------- wave end / intermission ---------------- */
    endWave() {
      if (!this.endless && this.wave >= C.WAVES.length) {
        this.collectAllDrops();
        /* no screen follows victory — crate rewards auto-take so the
           player never loses what they collected (spec §4) */
        for (const { item } of this.resolveCrates()) this.buyItem(item);
        this.victory();
        return;
      }
      /* the field is clear by definition here — wipe residuals only.
         Enemies that were defeated during overtime already dropped
         their loot through onKill. */
      this.enemies = [];
      this.markers = [];
      this.strikes = [];
      this.eprojs = [];
      this.hazards = [];
      this.bosses = [];
      /* Bair The Builder (spec §9): every 5 uncollected materials ->
         +1% Structure Attack Speed and +1 Structure Range. Counted
         once, applied once per wave, BEFORE residual collection — the
         counted drops are consumed (they are never collected). */
      let builderConv = 0;
      if (this.builderTurret) builderConv = this.convertUncollectedMaterials();
      this.collectAllDrops();

      /* harvesting income: grows 5% per activation until wave 20,
         then decays 20% per activation */
      const harvest = Math.round((this.stats.harvesting || 0) * this.harvestMul);
      if (harvest > 0) this.materials += harvest;
      this.harvestMul *= this.wave < C.WAVES.length ? 1.05 : 0.8;

      this.state = 'break';
      /* loot crates collected this wave -> one item each (spec §4) */
      const crateItems = this.resolveCrates();
      if (this.onWaveComplete) {
        this.onWaveComplete(this.wave, harvest, crateItems, builderConv);
      }
    }

    /* Builder conversion: count materials still on the ground, convert
       every 5 into +1% Structure Attack Speed +1 Structure Range */
    convertUncollectedMaterials() {
      const T = C.TURRET;
      let total = 0;
      for (const d of this.drops) {
        if (d.type === 'mat') total += d.val || 0;
      }
      const chunks = Math.floor(total / T.matsPerBonus);
      if (chunks <= 0) return 0;
      const add = chunks * T.rangePerChunk;
      this.stats.structureAttackSpeed += add;
      this.stats.structureRange += add;
      this.drops = this.drops.filter((d) => d.type !== 'mat');
      return add;
    }

    /* resolve collected loot crates into concrete item offers */
    resolveCrates() {
      const pairs = this.crates.map((c) => ({
        item: KS.Loot.rollCrateItem(this.wave, this.stats.luck || 0, c.special),
        special: !!c.special,
      }));
      this.crates = [];
      return pairs;
    }

    collectAllDrops() { this.updateDrops(0, true); }

    /* shop hooks */
    /* character stat-modification scaling (Bair The Builder, spec §8):
       damage gains are reduced by 75%, engineering gains are increased
       by 50% — applied to every upgrade / item that grants these */
    statGain(key, val) {
      const mods = this.charDef && this.charDef.statMods;
      if (!mods) return val;
      if (key === 'damage' && mods.damageMul != null) return val * mods.damageMul;
      if (key === 'engineering' && mods.engineeringMul != null) return val * mods.engineeringMul;
      return val;
    }

    /* new weapon INSTANCE: unique id, own tier/cooldown/mods (spec §10) */
    mkWeapon(defId, tier) {
      const def = C.WEAPONS[defId];
      if (!def) throw new Error('unknown weapon: ' + defId);
      return { uid: this.nextWeaponUid++, def, tier, timer: 0, mods: {} };
    }

    buyWeapon(id, tier) {
      if (this.weapons.length >= C.MAX_WEAPONS) return false;
      const w = this.mkWeapon(id, tier);
      this.weapons.push(w);
      this.applyWeaponFx(w, 1);      // e.g. Hand grants Harvesting
      return true;
    }
    sellWeapon(idx) {
      const w = this.weapons[idx];
      if (!w) return 0;
      if (this.weapons.length <= 1) return 0;
      const price = KS.Shop.weaponSellPrice(w.def.id, w.tier);
      this.applyWeaponFx(w, -1);     // remove its passive stats
      this.weapons.splice(idx, 1);
      this.materials += price;
      return price;
    }
    combineWeapon(idx) {
      const w = this.weapons[idx];
      if (!w || w.tier >= 4) return false;
      /* only works with a second copy of the SAME weapon at the SAME tier */
      const j = this.weapons.findIndex((x, i) =>
        i !== idx && x.def.id === w.def.id && x.tier === w.tier);
      if (j < 0) return false;
      const [hi, lo] = idx > j ? [idx, j] : [j, idx];
      this.applyWeaponFx(this.weapons[hi], -1);
      this.applyWeaponFx(this.weapons[lo], -1);
      this.weapons.splice(hi, 1);
      this.weapons.splice(lo, 1);
      const up = this.mkWeapon(w.def.id, w.tier + 1);
      this.weapons.push(up);
      this.applyWeaponFx(up, 1);
      return true;
    }
    buyItem(itemDef) {
      this.ownedItems.push(itemDef);
      for (const [key, val] of itemDef.fx) {
        this.stats[key] = (this.stats[key] || 0) + this.statGain(key, val);
      }
      if (itemDef.fx.some(([k]) => k === 'maxHP')) {
        /* extra max HP also heals nothing (Brotato rule) — cap stays */
      }
      this.player.refreshMaxHp(this.stats);
      return true;
    }
    spendMaterials(n) {
      if (this.materials < n) return false;
      this.materials -= n;
      return true;
    }

    defeat() {
      this.over = true;
      this.won = false;
      if (this.onRunEnd) this.onRunEnd({
        won: false, time: this.time, kills: this.kills,
        wave: this.wave, endless: this.endless, difficulty: this.difficulty,
      });
    }

    victory() {
      this.over = true;
      this.won = true;
      if (this.onRunEnd) this.onRunEnd({
        won: true, time: this.time, kills: this.kills,
        wave: this.wave, endless: this.endless, difficulty: this.difficulty,
      });
    }

    /* data for the pause menu / break screens */
    snapshot() {
      return {
        charDef: this.charDef,
        stats: this.stats,
        weapons: this.weapons.map((w) => ({ uid: w.uid, def: w.def, tier: w.tier })),
        maxWeapons: C.MAX_WEAPONS,
        items: this.ownedItems,
        materials: this.materials,
        level: this.level,
        xp: this.xp,
        xpNeed: this.xpNeed(),
        pendingLevels: this.pendingLevels,
        wave: this.wave,
        endless: this.endless,
        difficulty: this.difficulty,
        time: this.time,
        kills: this.kills,
      };
    }

    /* ---------------- render ---------------- */
    render() {
      const ctx = this.ctx;
      const { vw, vh, dpr } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = '#0b0812';
      ctx.fillRect(0, 0, vw, vh);
      if (!this.running) return;

      const { scale } = this.computeView();

      const p = this.player;
      const tx = p ? p.x - this.computeView().vw2 / 2 : (ARENA - this.computeView().vw2) / 2;
      const ty = p ? p.y - this.computeView().vh2 / 2 : (ARENA - this.computeView().vh2) / 2;
      const cx = Math.min(Math.max(tx, 0), Math.max(0, ARENA - this.computeView().vw2));
      const cy = Math.min(Math.max(ty, 0), Math.max(0, ARENA - this.computeView().vh2));
      this.camX += (cx - this.camX) * 0.22;
      this.camY += (cy - this.camY) * 0.22;

      ctx.save();
      if (this.shakeT > 0 && KS.Settings.get().screenshake) {
        const m = C.FX.shakeMag * (this.shakeT / C.FX.shakeTime);
        ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
      }
      ctx.scale(scale, scale);
      ctx.translate(-this.camX, -this.camY);

      /* arena */
      ctx.drawImage(this.arenaCv, 0, 0);

      /* enemy shadows */
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (const e of this.enemies) {
        if (e.dead) continue;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + e.r * 0.85, e.r * 0.8, e.r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      /* red X spawn markers — blink, 1s before spawn */
      if (this.markers.length) {
        const blinkOn = (performance.now() / 1000) % 0.66 < 0.4;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#ff2b2b';
        ctx.shadowColor = 'rgba(255,40,40,0.9)';
        ctx.shadowBlur = 10;
        for (const m of this.markers) {
          if (!blinkOn && KS.Settings.get().visualEffects) continue;
          const s = 13 + Math.sin(m.t * 9) * 2;
          ctx.globalAlpha = KS.Settings.get().visualEffects ? 0.95 : 0.8;
          ctx.beginPath();
          ctx.moveTo(m.x - s, m.y - s); ctx.lineTo(m.x + s, m.y + s);
          ctx.moveTo(m.x + s, m.y - s); ctx.lineTo(m.x - s, m.y + s);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      /* hazards under the enemies: clouds, warning circles, wave rings */
      KS.drawHazards(ctx, this.hazards, KS.Settings.get().visualEffects);

      /* enemies — sprite per identity, wind-up telegraphs, variant
         rings, shields (all inside Enemy.draw) */
      for (const e of this.enemies) {
        if (e.dead) continue;
        e.draw(ctx, this);
      }

      /* sacrificed enemies — fade-out puff */
      for (const d of this.dying) {
        const a = 1 - d.t / 0.3;
        ctx.save();
        ctx.globalAlpha = a * 0.8 * (KS.Settings.get().explosionOpacity / 100);
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * (1 + (1 - a) * 1.2), 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
        ctx.restore();
      }

      /* pickups: green material cubes, red fruit, wooden/golden crates */
      for (const d of this.drops) {
        const bob = Math.sin(d.t * 5) * 2;
        ctx.save();
        ctx.translate(d.x, d.y + bob);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, 7 - bob, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        const r = 5.5;
        if (d.type === 'fruit') {
          /* apple: red body + green leaf + shine */
          ctx.shadowColor = 'rgba(255, 90, 70, 0.85)';
          ctx.shadowBlur = 9;
          ctx.fillStyle = '#e8402e';
          ctx.strokeStyle = 'rgba(80,10,5,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 1, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#3fae4a';
          ctx.beginPath();
          ctx.ellipse(3.5, -r + 1.5, 3.4, 1.7, -0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(-2, -0.5, 1.8, 0, Math.PI * 2);
          ctx.fill();
        } else if (d.type === 'crate') {
          /* loot crate: wooden box with straps; boss crates are golden */
          const gold = !!d.special;
          ctx.shadowColor = gold ? 'rgba(255, 200, 40, 0.95)' : 'rgba(160, 110, 45, 0.8)';
          ctx.shadowBlur = gold ? 12 : 7;
          ctx.fillStyle = gold ? '#e8b53a' : '#a4713a';
          ctx.strokeStyle = gold ? 'rgba(90,60,5,0.95)' : 'rgba(45,25,5,0.95)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(-r, -r, r * 2, r * 2, 2);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = gold ? 'rgba(120,80,10,0.9)' : 'rgba(60,35,10,0.8)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
          ctx.moveTo(0, -r); ctx.lineTo(0, r);
          ctx.stroke();
        } else {
          ctx.shadowColor = 'rgba(90, 235, 120, 0.8)';
          ctx.shadowBlur = 8;
          ctx.fillStyle = '#5ee87f';
          ctx.strokeStyle = 'rgba(10,60,25,0.9)';
          ctx.lineWidth = 2;
          const r2 = 4;
          ctx.beginPath();
          ctx.roundRect(-r2, -r2, r2 * 2, r2 * 2, 2.5);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      /* player */
      if (p) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + p.r * 0.9, p.r * 0.85, p.r * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();

        /* accessibility: character highlighting ring */
        if (KS.Settings.get().hlCharacter) {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + p.r * 0.55, p.r * 1.15, p.r * 0.5, 0, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 230, 0, 0.95)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        const bobY = p.moving ? Math.sin(p.bob) * 2.4 : 0;
        const blink = p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0;
        const img = this.images.portrait;
        const h = p.r * 2.9;
        const w2 = h * (img.width / img.height);
        ctx.save();
        ctx.globalAlpha = blink ? 0.45 : 1;
        ctx.drawImage(img, p.x - w2 / 2, p.y + bobY - h * 0.62, w2, h);
        ctx.restore();

        /* HP bar on character (setting) */
        if (KS.Settings.get().hpBarChar) {
          const bw = 44, bh = 6, bx = p.x - bw / 2, by = p.y + p.r * 1.25;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
          ctx.fillStyle = p.hp / p.maxHP < 0.3 ? '#ff5b5b' : '#5ee87f';
          ctx.fillRect(bx, by, bw * Math.max(0, p.hp / p.maxHP), bh);
        }
      }

      /* Builder's Turret structure + its projectiles */
      if (this.turret) this.turret.draw(ctx);

      /* weapon strikes — each strike flies dead straight (out & back)
         carrying its weapon's attack image (spec §5-§6) */
      for (const s of this.strikes) {
        if (s.dead) continue;
        const pos = s.pos();
        const img = s.img || this.images.fist;
        const aspect = img.width / img.height;
        const h = (s.size || 44) + s.progress() * 10;
        const wd = h * aspect;
        const ang = Math.atan2(s.dirY, s.dirX);
        ctx.save();
        if (KS.Settings.get().hlWeapons) {
          ctx.shadowColor = 'rgba(255,230,0,0.9)';
          ctx.shadowBlur = 12;
        }
        ctx.translate(pos.x, pos.y);
        ctx.rotate(ang + Math.PI / 2);
        ctx.drawImage(img, -wd / 2, -h / 2, wd, h);
        ctx.restore();
      }

      /* damage numbers */
      ctx.textAlign = 'center';
      for (const n of this.dmgNums) {
        if (n.dead) continue;
        const a = Math.max(0, 1 - n.t / C.FX.dmgNumLife);
        ctx.globalAlpha = a;
        ctx.font = n.crit ? `bold 26px ${FONT}` : `bold 19px ${FONT}`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(n.val, n.x, n.y);
        ctx.fillStyle = n.crit ? '#ffb020' : '#ffffff';
        ctx.fillText(n.val, n.x, n.y);
        if (n.crit) {
          ctx.font = `bold 13px ${FONT}`;
          ctx.strokeText('CRIT!', n.x, n.y + 16);
          ctx.fillText('CRIT!', n.x, n.y + 16);
        }
        ctx.globalAlpha = 1;
      }

      /* enemy projectiles (above enemies, below the player) */
      const fxOn = KS.Settings.get().visualEffects;
      for (const pr of this.eprojs) {
        if (!pr.dead) pr.draw(ctx, fxOn);
      }

      ctx.restore();

      /* wave banner (screen space) */
      if (this.waveBannerT > 0 && this.state === 'wave') {
        const t = this.waveBannerT;
        const a = Math.min(1, t / 0.4, (2.2 - t) / 0.35 + 0.15);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.textAlign = 'center';
        ctx.font = `900 ${Math.round(Math.min(vw, vh) * 0.09)}px ${FONT}`;
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        const label = `WAVE ${this.wave}`;
        ctx.strokeText(label, vw / 2, vh * 0.24);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(label, vw / 2, vh * 0.24);
        ctx.restore();
      }

      /* overtime: field must be cleared before the shop opens */
      if (this.state === 'wave' && this.waveTime <= 0 &&
          (this.enemies.some(e => !e.dead) || this.markers.length > 0)) {
        const msg = (typeof KS.t === 'function' && KS.t('clearRemaining')) || 'CLEAR THE REMAINING ENEMIES';
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 280));
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.textAlign = 'center';
        ctx.font = `800 ${Math.round(Math.min(vw, vh) * 0.030)}px ${FONT}`;
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(msg, vw / 2, vh * 0.175);
        ctx.fillStyle = '#ffd23f';
        ctx.fillText(msg, vw / 2, vh * 0.175);
        ctx.restore();
      }

      /* boss name under the wave banner (red, unmistakable) */
      if (this.bossBannerT > 0 && this.bossBanner && this.state === 'wave') {
        const t = this.bossBannerT;
        const a = Math.min(1, t / 0.5, (3.4 - t) / 0.45 + 0.2);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.textAlign = 'center';
        ctx.font = `900 ${Math.round(Math.min(vw, vh) * 0.052)}px ${FONT}`;
        ctx.lineWidth = 7;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(this.bossBanner, vw / 2, vh * 0.34);
        ctx.fillStyle = '#ff5b5b';
        ctx.fillText(this.bossBanner, vw / 2, vh * 0.34);
        ctx.restore();
      }
    }
  }

  KS.Game = Game;
})();
