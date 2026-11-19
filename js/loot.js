/* =========================================================
   LOOT — material / consumable / crate drop math (spec §3-§5).
   Pure probability layer between a kill and the pickup list.
   All knobs live in CONFIG.LOOT and per-enemy `consumable`
   / `crate` fields; nothing here hardcodes balance numbers.
   ========================================================= */
window.KS = window.KS || {};

KS.Loot = (() => {
  const C = KS.CONFIG;

  /* luck multiplier: +100 luck doubles every luck-scaled chance */
  function luckMul(luck) { return 1 + (luck || 0) / 100; }

  /* ---- material drop chance by wave (spec §3) ----
     waves 1-4: 100%; from wave 5: 1 + matPerWave * wave (i.e.
     100% - 1.5pp per wave), floored at matMin. Horde waves
     (quota >= hordeQuota) multiply by hordeMul. Bosses bypass. */
  function materialChance(wave, quotaUnits) {
    const L = C.LOOT;
    let ch = wave <= L.matFlatWaves
      ? 1
      : Math.max(L.matMin, 1 + L.matPerWave * wave);
    if ((quotaUnits || 0) >= L.hordeQuota) ch *= L.hordeMul;
    return Math.min(1, ch);
  }

  /* ---- crate chance with diminishing returns (spec §4) ----
     base * (1 + luck/100) / (1 + crates already dropped this wave) */
  function crateChance(base, luck, dropped) {
    return Math.min(1, (base || 0) * luckMul(luck) / (1 + (dropped || 0)));
  }

  /* roll the full kill loot for one defeated enemy.
     e needs: rewardBase (def.reward), rewardMul (variant), def
     (for consumable/crate chances), boss flag.
     game needs: wave, waveQuotaUnits, stats.luck, stats.doubleMaterial,
     cratesDropped (ordinary crates spawned this wave). */
  function rollForKill(game, e) {
    const out = { mats: 0, fruit: 0, crate: 0, crateSpecial: false };
    const boss = !!e.boss;
    const mul = e.rewardMul || 1;
    const luck = game.stats.luck || 0;

    /* --- materials --- */
    const matChance = boss ? 1 : materialChance(game.wave, game.waveQuotaUnits || 0);
    if (Math.random() < matChance) {
      /* value scales with the variant; a fractional remainder is a
         probability roll for one extra pickup, never silent rounding */
      const raw = Math.max(1, (e.rewardBase || 1)) * mul;
      let val = Math.floor(raw);
      const frac = raw - val;
      if (frac > 0 && Math.random() < frac) val++;
      if ((game.stats.doubleMaterial || 0) > 0 &&
          Math.random() * 100 < game.stats.doubleMaterial) val *= 2;
      out.mats = Math.max(1, val);
    }

    /* --- consumables: roll 1 = does a consumable drop at all;
         roll 2 = crate or fruit. Luck boosts both; crates get
         rarer as more ordinary crates drop during the wave. --- */
    if (!boss) {
      const cc = Math.min(1, ((e.def && e.def.consumable) || 0) * mul * luckMul(luck));
      if (Math.random() < cc) {
        if (Math.random() < crateChance(e.def && e.def.crate, luck, game.cratesDropped || 0)) {
          out.crate = 1;
        } else {
          out.fruit = 1;
        }
      }
    }
    return out;
  }

  /* ---- crate -> item resolution (spec §4-§5) ----
     Ordinary crates roll a tier from the wave + luck; boss
     "special" crates are bumped one tier (capped at 4) so boss
     rewards are noticeably better. */
  function rollCrateItem(wave, luck, special) {
    let tier = KS.Shop.rollItemTier(wave, luck);
    if (special) tier = Math.min(4, tier + 1);
    return KS.Shop.rollItemOfTier(tier);
  }

  return { luckMul, materialChance, crateChance, rollForKill, rollCrateItem };
})();
