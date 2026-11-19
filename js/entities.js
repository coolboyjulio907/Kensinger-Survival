/* =========================================================
   Entities: Player, Enemy, floating damage numbers, weapon strikes.
   The Player now references the run's MUTABLE stats object, so
   level-up upgrades / shop items affect it immediately.
   ========================================================= */
window.KS = window.KS || {};
(function () {
  const C = KS.CONFIG;

  /* ---------------- Player ---------------- */
  class Player {
    /* stats = the run's live (mutable) stat object */
    constructor(stats) {
      this.stats = stats;
      const a = KS.arenaSize();
      this.x = a / 2;
      this.y = a / 2;
      this.r = C.PLAYER.radius;
      this.hp = stats.maxHP;
      this.maxHP = stats.maxHP;
      this.level = stats.level || 1;
      this.invuln = 0;
      this.moving = false;
      this.bob = 0;
      this.age = 0;
      this.regenAcc = 0;
      this.lastSteal = -Infinity;
    }

    /* keep hp ratio sane when max HP changes */
    refreshMaxHp(stats) {
      this.stats = stats;
      const ratio = this.maxHP ? this.hp / this.maxHP : 1;
      this.maxHP = stats.maxHP;
      this.hp = Math.min(this.maxHP, Math.ceil(this.maxHP * ratio));
    }

    /* % move speed stat applies on top of the base speed */
    get effSpeed() {
      return this.stats.speed * (1 + (this.stats.speedPct || 0) / 100);
    }

    update(dt, slowMul = 1) {
      this.age += dt;
      const px0 = this.x, py0 = this.y;
      const ax = KS.Input.axis();
      this.moving = false;
      const sp = this.effSpeed * slowMul;

      if (KS.Settings.get().mouseOnly) {
        /* walk toward the cursor past a small deadzone */
        const g = KS.Input.gamepadAxis();
        if (g.x || g.y) {
          this.x += g.x * sp * dt;
          this.y += g.y * sp * dt;
          this.moving = true;
        } else {
          const m = KS.Input.mouse;
          const game = window.KSDBG && window.KSDBG.game;
          if (game && m.inside) {
            const w = game.mouseWorld();
            const dx = w.x - this.x, dy = w.y - this.y;
            const d = Math.hypot(dx, dy);
            if (d > 14) {
              const s2 = Math.min(sp, d * 6);
              this.x += (dx / d) * s2 * dt;
              this.y += (dy / d) * s2 * dt;
              this.moving = true;
            }
          }
        }
      } else if (ax.x !== 0 || ax.y !== 0) {
        this.x += ax.x * sp * dt;
        this.y += ax.y * sp * dt;
        this.moving = true;
      }

      /* real velocity — enemies that lead their shots read this */
      this.vx = dt > 0 ? (this.x - px0) / dt : 0;
      this.vy = dt > 0 ? (this.y - py0) / dt : 0;

      if (this.moving) this.bob += dt * 11;
      const a = KS.arenaSize();
      this.x = Math.min(Math.max(this.x, this.r), a - this.r);
      this.y = Math.min(Math.max(this.y, this.r), a - this.r);
      if (this.invuln > 0) this.invuln -= dt;

      const rate = KS.hpRegenRate(this.stats.hpRegen || 0);
      if (rate > 0 && this.hp < this.maxHP) {
        this.regenAcc += rate * dt;
        while (this.regenAcc >= 1 && this.hp < this.maxHP) {
          this.hp++;
          this.regenAcc -= 1;
        }
        if (this.hp >= this.maxHP) this.regenAcc = 0;
      }
    }

    hurt(dmg) {
      if (this.invuln > 0) return null;
      if (this.noDamage) return null;   // dev command: /stat hp disable
      const dodge = Math.min(60, this.stats.dodge || 0);
      if (dodge > 0 && Math.random() * 100 < dodge) {
        this.invuln = 0.25;
        return 'dodge';
      }
      const red = KS.armorReduction(this.stats.armor || 0);
      this.hp -= dmg * (1 - red / 100);
      this.invuln = C.PLAYER.invulnTime;
      return 'hit';
    }

    tryLifesteal() {
      const ls = this.stats.lifeSteal || 0;
      if (ls <= 0) return false;
      if (this.age - this.lastSteal < 0.1) return false;
      if (this.hp >= this.maxHP) return false;
      if (Math.random() * 100 < ls) {
        this.hp = Math.min(this.maxHP, this.hp + 1);
        this.lastSteal = this.age;
        return true;
      }
      return false;
    }
  }

  /* ---------------- Enemy ----------------
     The data-driven Enemy (nine types, variants, bosses) now lives
     in enemies.js — see KS.Enemy there. */

  /* ---------------- Floating damage number ---------------- */
  class DamageNumber {
    constructor(x, y, val, crit) {
      this.x = x; this.y = y;
      this.val = typeof val === 'number' ? (Math.round(val * 10) / 10) : val;
      this.crit = crit;
      this.t = 0;
      this.dead = false;
    }
    update(dt) {
      this.t += dt;
      this.y -= C.FX.dmgNumSpeed * dt;
      if (this.t >= C.FX.dmgNumLife) this.dead = true;
    }
  }

  /* ---------------- Weapon strike (lunge out & back) ----------------
     The strike LOCKS its direction the instant it is fired, then flies
     dead straight — it never turns to track enemies mid-flight. It
     travels out to its max distance and retracts, and can hit EVERY
     enemy it touches along the way (infinite piercing). */
  class Strike {
    constructor(x, y, dirX, dirY, dist, opts = {}) {
      this.x = x; this.y = y;
      this.dirX = dirX; this.dirY = dirY;
      this.dist = dist;              // max travel distance (reached halfway)
      this.dmg = opts.dmg || 0;
      this.crit = !!opts.crit;
      this.kb = opts.kb || 0;        // knockback impulse
      this.hitR = opts.hitR || 16;   // collision radius vs enemy circles
      this.hits = new Set();         // enemies already struck (infinite pierce)
      this.stole = false;            // life steal rolls once per swing
      this.img = opts.img || null;   // per-weapon attack visual (spec §5-§6)
      this.size = opts.size || 44;   // art-proportional base height
      this.t = 0;
      this.dur = 0.18;
      this.dead = false;
    }
    update(dt) {
      this.t += dt;
      if (this.t >= this.dur) this.dead = true;
    }
    /* current distance from the origin: out (fast) then straight back */
    travel() {
      const p = Math.min(1, this.t / this.dur);
      if (p < 0.4) { const t = p / 0.4; return this.dist * (1 - (1 - t) * (1 - t)); }
      const t = (p - 0.4) / 0.6;
      return this.dist * (1 - t);
    }
    pos() {
      const r = this.travel();
      return { x: this.x + this.dirX * r, y: this.y + this.dirY * r };
    }
    /* kept for compatibility: 0..1 progress of the whole lunge */
    progress() {
      const p = Math.min(1, this.t / this.dur);
      if (p < 0.4) { const t = p / 0.4; return 1 - (1 - t) * (1 - t); }
      const t = (p - 0.4) / 0.6;
      return 1 - t;
    }
  }

  KS.Player = Player;
  KS.DamageNumber = DamageNumber;
  KS.Strike = Strike;
})();
