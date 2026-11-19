/* =========================================================
   Level-up upgrades — 16 primary stats x 4 tiers.
   - Tier values exactly per user table (Heart I-IV, etc.).
   - Rarity roll uses the wave/level rarity curve modified by
     Luck: T2/T3/T4 chances scale by (1 + luck/100), T1 takes
     the remainder clamped to a 40% floor (deficit eaten from
     T2 first) — reproduces the user's 0/50/100-luck tables.
   - Guaranteed rarity: L1 -> T1, L5 -> T2, L10/15/20 -> T3,
     L25 & every 5th after -> T4 (all four choices).
   ========================================================= */
window.KS = window.KS || {};

KS.Upgrades = (() => {
  /* icon, stat key, per-tier bonus values, per-tier display names */
  const STATS = [
    { key: 'maxHP',        icon: '❤️', name: { en: 'Max HP', es: 'Vida máxima' },
      vals: [3, 6, 9, 12],            names: ['Heart', 'Heart II', 'Heart III', 'Heart IV'] },
    { key: 'hpRegen',      icon: '🫁', name: { en: 'HP Regeneration', es: 'Regeneración' },
      vals: [2, 3, 4, 5],             names: ['Lungs', 'Lungs II', 'Lungs III', 'Lungs IV'] },
    { key: 'lifeSteal',    icon: '🦷', name: { en: 'Life Steal', es: 'Robo de vida' },
      vals: [1, 2, 3, 4],             names: ['Teeth', 'Teeth II', 'Teeth III', 'Teeth IV'] },
    { key: 'damage',       icon: '💪', name: { en: 'Damage', es: 'Daño' },
      vals: [5, 8, 12, 16],           names: ['Triceps', 'Triceps II', 'Triceps III', 'Triceps IV'] },
    { key: 'meleeDMG',     icon: '🤜', name: { en: 'Melee Damage', es: 'Daño melé' },
      vals: [2, 4, 6, 8],             names: ['Forearms', 'Forearms II', 'Forearms III', 'Forearms IV'] },
    { key: 'rangedDMG',    icon: '🦾', name: { en: 'Ranged Damage', es: 'Daño a distancia' },
      vals: [1, 2, 3, 4],             names: ['Shoulders', 'Shoulders II', 'Shoulders III', 'Shoulders IV'] },
    { key: 'elementalDMG', icon: '🧠', name: { en: 'Elemental Damage', es: 'Daño elemental' },
      vals: [1, 2, 3, 4],             names: ['Brain', 'Brain II', 'Brain III', 'Brain IV'] },
    { key: 'attackSpeed',  icon: '⚡', name: { en: 'Attack Speed', es: 'Vel. de ataque' },
      vals: [5, 10, 15, 20],          names: ['Reflexes', 'Reflexes II', 'Reflexes III', 'Reflexes IV'] },
    { key: 'critChance',   icon: '🤞', name: { en: 'Crit Chance', es: 'Prob. de crítico' },
      vals: [3, 5, 7, 9],             names: ['Fingers', 'Fingers II', 'Fingers III', 'Fingers IV'] },
    { key: 'engineering',  icon: '💀', name: { en: 'Engineering', es: 'Ingeniería' },
      vals: [2, 3, 4, 5],             names: ['Skull', 'Skull II', 'Skull III', 'Skull IV'] },
    { key: 'range',        icon: '👁️', name: { en: 'Range', es: 'Alcance' },
      vals: [15, 30, 45, 60],         names: ['Eyes', 'Eyes II', 'Eyes III', 'Eyes IV'] },
    { key: 'armor',        icon: '🦺', name: { en: 'Armor', es: 'Armadura' },
      vals: [1, 2, 3, 4],             names: ['Chest', 'Chest II', 'Chest III', 'Chest IV'] },
    { key: 'dodge',        icon: '🧥', name: { en: 'Dodge', es: 'Evasión' },
      vals: [3, 6, 9, 12],            names: ['Back', 'Back II', 'Back III', 'Back IV'] },
    { key: 'speedPct',     icon: '🦵', name: { en: 'Speed', es: 'Velocidad' },
      vals: [3, 6, 9, 12],            names: ['Legs', 'Legs II', 'Legs III', 'Legs IV'] },
    { key: 'luck',         icon: '👃', name: { en: 'Luck', es: 'Suerte' },
      vals: [5, 10, 15, 20],          names: ['Nose', 'Nose II', 'Nose III', 'Nose IV'] },
    { key: 'harvesting',   icon: '🤲', name: { en: 'Harvesting', es: 'Recolección' },
      vals: [5, 8, 10, 12],           names: ['Hands', 'Hands II', 'Hands III', 'Hands IV'] },
  ];

  /* base rarity curve, 0 Luck, waves/levels 1..19 (percent) — user table */
  const BASE = [
    /*  1 */ [100,  0,    0,    0  ],
    /*  2 */ [ 94,  6,    0,    0  ],
    /*  3 */ [ 88,  12,   0,    0  ],
    /*  4 */ [ 82,  16,   2,    0  ],
    /*  5 */ [ 76,  20,   4,    0  ],
    /*  6 */ [ 70,  24,   6,    0  ],
    /*  7 */ [ 64,  28,   8,    0  ],
    /*  8 */ [ 58,  32,   9.8,  0.2],
    /*  9 */ [ 52,  36,   11.5, 0.5],
    /* 10 */ [ 46,  40,   13.3, 0.7],
    /* 11 */ [ 40,  44,   15.1, 0.9],
    /* 12 */ [ 40,  42,   16.9, 1.2],
    /* 13 */ [ 40,  40,   18.6, 1.4],
    /* 14 */ [ 40,  38,   20.4, 1.6],
    /* 15 */ [ 40,  36,   22.2, 1.8],
    /* 16 */ [ 40,  35,   22.9, 2.1],
    /* 17 */ [ 40,  35,   22.7, 2.3],
    /* 18 */ [ 40,  35,   22.5, 2.5],
    /* 19 */ [ 40,  35,   22.2, 2.8],
  ];

  /* luck-adjusted chances for a given wave/level index */
  function chances(index, luck) {
    const b = BASE[Math.min(Math.max(index, 1), BASE.length) - 1];
    const L = 1 + Math.max(0, luck || 0) / 100;
    let t2 = b[1] * L, t3 = b[2] * L, t4 = b[3] * L;
    let t1 = 100 - (t2 + t3 + t4);
    if (t1 < 40) {
      const deficit = 40 - t1;
      t1 = 40;
      t2 -= deficit;
      if (t2 < 0) { t3 += t2; t2 = 0; }
      if (t3 < 0) { t4 += t3; t3 = 0; }
      if (t4 < 0) t4 = 0;
    }
    return [t1, t2, t3, t4];
  }

  /* guaranteed-tier levels (user spec) */
  function guaranteedTier(level) {
    if (level === 1) return 1;
    if (level === 5) return 2;
    if (level === 10 || level === 15 || level === 20) return 3;
    if (level >= 25 && (level - 25) % 5 === 0) return 4;
    return 0;
  }

  function rollTier(level, luck) {
    const g = guaranteedTier(level);
    if (g) return g;
    const ch = chances(level, luck);
    let r = Math.random() * 100;
    for (let t = 0; t < 4; t++) {
      r -= ch[t];
      if (r <= 0) return t + 1;
    }
    return 1;
  }

  function statDef(key) { return STATS.find((s) => s.key === key); }

  function statName(def) {
    const lang = (KS.Settings && KS.Settings.get().language) || 'en';
    return def.name[lang] || def.name.en;
  }

  /* effect text, e.g. "+3 Max HP" */
  function effectText(def, tier) {
    const v = def.vals[tier - 1];
    const suffix = def.key === 'range' ? '' : '';
    return `+${v} ${statName(def)}${suffix}`;
  }

  /* roll 4 distinct stat upgrades at a given level */
  function rollChoices(level, luck) {
    const pool = STATS.slice();
    const picks = [];
    for (let i = 0; i < 4 && pool.length; i++) {
      const idx = (Math.random() * pool.length) | 0;
      const def = pool.splice(idx, 1)[0];
      const tier = rollTier(level, luck);
      picks.push({ stat: def, tier, icon: def.icon });
    }
    return picks;
  }

  /* apply an upgrade to the mutable run-stats object */
  function apply(upg, stats, transform) {
    const key = upg.stat.key;
    let v = upg.stat.vals[upg.tier - 1];
    if (typeof transform === 'function') v = transform(key, v);
    stats[key] = (stats[key] || 0) + v;
    if (key === 'dodge') stats.dodge = Math.min(60, stats.dodge);
    return v;
  }

  /* how much maxHP an upgrade grants (so the player object can react) */
  function maxHpGain(upg) {
    return upg.stat.key === 'maxHP' ? upg.stat.vals[upg.tier - 1] : 0;
  }

  return { STATS, chances, guaranteedTier, rollTier, rollChoices, apply, maxHpGain, statName, effectText, statDef };
})();
