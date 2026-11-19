/* =========================================================
   Shop — 4 purchasable slots (slot 1 is always a Fist offer,
   the rest can also roll weapons), tier rarity by wave + Luck,
   inflation, locking, and the user's reroll pricing formula.
   - Reroll Increase: max(1, floor(0.40 * wave))
   - First Reroll:    floor(wave * 0.75) + Increase
   - Every reroll after adds the Increase again.
   - Locked entries survive rerolls AND waves at a frozen price.
   - Weapon base prices: Fist = 12 x tier mult, Hand = 10/22/45/91.
   ========================================================= */
window.KS = window.KS || {};

KS.Shop = (() => {
  const C = KS.CONFIG;
  const SLOTS = 4;
  const FIST_BASE_PRICE = 12;
  const FIST_TIER_MULT = [1, 2.2, 4.2, 8];
  const INFLATION = 0.14;   // +14% base price per wave (linear)
  const WEAPON_SLOT_CHANCE = 0.25;   // slots 2-4: chance to roll a weapon

  /* placeholder item pool (real item art arrives later) */
  const ITEMS = [
    /* tier 1 */
    { id: 'screwdriver', tier: 1, icon: '🔧', name: { en: 'Screwdriver', he: 'מברג' },   price: 12, fx: [['meleeDMG', 2]] },
    { id: 'apple',       tier: 1, icon: '🍎', name: { en: 'Apple', he: 'תפוח' },         price: 14, fx: [['hpRegen', 1]] },
    { id: 'shoes',       tier: 1, icon: '👟', name: { en: 'Running Shoes', he: 'נעלי ריצה' }, price: 16, fx: [['speedPct', 3]] },
    { id: 'coin',        tier: 1, icon: '🪙', name: { en: 'Lucky Coin', he: 'מטבע מזל' },    price: 15, fx: [['harvesting', 3]] },
    { id: 'glove',       tier: 1, icon: '🧤', name: { en: 'Worn Glove', he: 'כפפה בלויה' },    price: 16, fx: [['lifeSteal', 1]] },
    { id: 'bolt',        tier: 1, icon: '⚙️', name: { en: 'Rusty Bolt', he: 'בורג חלוד' },    price: 13, fx: [['armor', 1]] },
    /* tier 2 */
    { id: 'meat',        tier: 2, icon: '🍖', name: { en: 'Meat Snack', he: 'חטיף בשר' },       price: 26, fx: [['maxHP', 6]] },
    { id: 'energy',      tier: 2, icon: '🥤', name: { en: 'Energy Drink', he: 'משקה אנרגיה' },     price: 28, fx: [['attackSpeed', 8]] },
    { id: 'clover',      tier: 2, icon: '🍀', name: { en: 'Four-Leaf Clover', he: 'תלתן ארבעה עלים' }, price: 27, fx: [['luck', 8]] },
    { id: 'magnet',      tier: 2, icon: '🧲', name: { en: 'Magnet', he: 'מגנט' },           price: 24, fx: [['pickupRange', 40]] },
    { id: 'tape',        tier: 2, icon: '📼', name: { en: 'Duct Tape', he: 'נאדית דבק' },        price: 25, fx: [['armor', 2]] },
    /* tier 3 */
    { id: 'alien',       tier: 3, icon: '👽', name: { en: 'Alien Eyes', he: 'עיני חייזר' },    price: 48, fx: [['range', 30]] },
    { id: 'plate',       tier: 3, icon: '🛡️', name: { en: 'Chest Plate', he: 'שריון חזה' },   price: 55, fx: [['armor', 3], ['maxHP', 4]] },
    { id: 'protein',     tier: 3, icon: '🥛', name: { en: 'Protein Shake', he: 'שייק חלבון' }, price: 50, fx: [['hpRegen', 2], ['maxHP', 5]] },
    { id: 'battery',     tier: 3, icon: '🔋', name: { en: 'Power Cell', he: 'תא כוח' },    price: 46, fx: [['engineering', 2]] },
    /* tier 4 */
    { id: 'goldheart',   tier: 4, icon: '💛', name: { en: 'Golden Heart', he: 'לב זהב' },  price: 88, fx: [['maxHP', 12]] },
    { id: 'rocket',      tier: 4, icon: '🚀', name: 'Rocket Boots',  price: 92, fx: [['speedPct', 10], ['dodge', 4]] },
    { id: 'crown',       tier: 4, icon: '👑', name: 'Trophy Crown',  price: 85, fx: [['luck', 15], ['harvesting', 8]] },
  ];

  function inflated(base, wave) {
    return Math.max(1, Math.round(base * (1 + INFLATION * (wave - 1))));
  }

  /* user's reroll pricing table */
  function rerollIncrease(wave) {
    return Math.max(1, Math.floor(0.40 * wave));
  }
  function rerollPrice(wave, rerollsDone) {
    return Math.floor(wave * 0.75) + rerollIncrease(wave) + rerollsDone * rerollIncrease(wave);
  }

  function rollItemTier(wave, luck) {
    const ch = KS.Upgrades.chances(wave, luck);
    let r = Math.random() * 100;
    for (let t = 0; t < 4; t++) {
      r -= ch[t];
      if (r <= 0) return t + 1;
    }
    return 1;
  }

  function randomItem(tier, exclude) {
    let pool = ITEMS.filter((it) => it.tier === tier && !exclude.includes(it.id));
    if (!pool.length) pool = ITEMS.filter((it) => !exclude.includes(it.id));
    if (!pool.length) pool = ITEMS.filter((it) => it.tier === tier);
    return pool[(Math.random() * pool.length) | 0];
  }

  function rollWeaponEntry(wave, luck, forcedId) {
    const tier = rollItemTier(wave, luck);
    const id = forcedId || 'fist';
    return {
      kind: 'weapon', id, tier,
      price: inflated(weaponBasePrice(id, tier), wave),
      locked: false,
    };
  }

  /* slots 2-4: mostly items, but sometimes a weapon offer so new
     weapons (e.g. the Hand) can actually be bought */
  function rollSlot(wave, luck, excludeIds) {
    if (Math.random() < WEAPON_SLOT_CHANCE) {
      const ids = Object.keys(C.WEAPONS).filter((id) => !excludeIds.includes(id));
      const id = ids.length ? ids[(Math.random() * ids.length) | 0]
                            : 'fist';
      return rollWeaponEntry(wave, luck, id);
    }
    const tier = rollItemTier(wave, luck);
    const it = randomItem(tier, excludeIds);
    return { kind: 'item', id: it.id, tier, price: inflated(it.price, wave), locked: false };
  }

  /* generate the 4 shop slots for a wave; `prev` keeps locked entries.
     Sold entries NEVER persist — even if they were locked — so a bought
     card's box is gone (emptied) until the next reroll brings a fresh item. */
  function roll(wave, luck, prev) {
    const entries = [];
    const usedIds = [];
    /* slot 1: always a Fist offer ("appears constantly, even when rerolling") */
    const prevFist = prev && prev[0] && prev[0].locked && !prev[0].sold ? prev[0] : null;
    entries.push(prevFist || rollWeaponEntry(wave, luck));
    if (prevFist) usedIds.push(prevFist.id);
    for (let i = 1; i < SLOTS; i++) {
      const p = prev && prev[i];
      if (p && p.locked && !p.sold) { entries.push(p); usedIds.push(p.id); continue; }
      const entry = rollSlot(wave, luck, usedIds);
      usedIds.push(entry.id);
      entries.push(entry);
    }
    return entries;
  }

  function itemDef(id) { return ITEMS.find((it) => it.id === id); }

  /* crate rewards: pick a random item of an exact tier (falls back to
     the closest tier that has items) */
  function rollItemOfTier(tier) {
    let pool = ITEMS.filter((it) => it.tier === tier);
    while (!pool.length && tier > 1) { tier--; pool = ITEMS.filter((it) => it.tier === tier); }
    if (!pool.length) pool = ITEMS.filter((it) => it.tier === 1);
    return pool[(Math.random() * pool.length) | 0];
  }

  /* weapon prices: per-weapon tier base (before inflation) + 50% sell-back */
  function weaponBasePrice(id, tier) {
    const def = C.WEAPONS[id];
    if (def && def.tierPrices) return def.tierPrices[tier - 1];
    return Math.round(FIST_BASE_PRICE * FIST_TIER_MULT[tier - 1]);
  }
  function weaponSellPrice(id, tier) {
    return Math.max(1, Math.round(weaponBasePrice(id, tier) * 0.5));
  }

  return { SLOTS, ITEMS, roll, rollItemTier, rollItemOfTier, rerollPrice, rerollIncrease, inflated, itemDef, weaponBasePrice, weaponSellPrice, FIST_BASE_PRICE, FIST_TIER_MULT };
})();
