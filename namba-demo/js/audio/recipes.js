// =============================================================================
// Recipe registry: name → synthesized sample data. Names are stable cache
// keys, e.g. 'fs:tile:sneaker:3', 'mus:bossa', 'bed:hvac:tile', 'ir:platform',
// 'ir:platform'. Worker-safe (imported by worker.js). (No synthesized speech: the PA uses real voices.)
// =============================================================================
import * as F from './foley.js';
import * as M from './music.js';
import * as B from './beds.js';
import * as T from './trainsfx.js';
import { impulse } from './ir.js';
import { walla } from './formant.js';

const mono = (a) => [a];

// sample rate a recipe is rendered at, given the context rate
export function rateFor(name, base) {
  const cap = Math.min(base, 48000);
  const kind = name.split(':')[0];
  if (kind === 'ir') return base;
  if (kind === 'mus') return Math.min(cap, 24000); // long loops: speaker EQ cuts >7.5 kHz anyway
  if (kind === 'mel' || kind === 'chime') return Math.min(cap, 32000);
  if (kind === 'bed') { const v = name.split(':')[1]; return v === 'leaves' || v === 'water' || v === 'steps' ? Math.min(cap, 32000) : Math.min(cap, 24000); }
  if (name === 'tr:roll' || name === 'tr:aux') return Math.min(cap, 24000);
  return cap;
}

export function synthesize(name, base) {
  const sr = rateFor(name, base);
  const p = name.split(':');
  let ch, loop = false;
  switch (p[0]) {
    case 'fs': ch = mono(p[1] === 'squeak' ? F.squeak(sr, +p[2] || 0) : F.footstep(sr, p[1], +p[3] || 0, p[2] || 'sneaker')); break;
    case 'ui': {
      const fn = { select: F.select, rustle: F.rustle, gate_ok: F.gateOk, gate_low: F.gateLow, gate_fail: F.gateFail, phone_open: F.phoneOpen, phone_close: F.phoneClose, notify: F.notify, order: F.order, pay: F.pay, cup: F.cup, bell: F.counterBell }[p[1]];
      if (!fn) throw new Error('no ui sound ' + p[1]);
      ch = mono(fn(sr)); break;
    }
    case 'mus': {
      const fn = { jpop: M.shopJpop, citypop: M.shopCitypop, bossa: M.shopBossa, drug: M.shopDrug, game: M.shopGame, dept: M.bgmDept }[p[1]];
      const res = fn(sr, +p[2] || 0); ch = res.channels; loop = true; break;
    }
    case 'mel': { const fn = { midosuji: M.melMidosuji, sennichimae: M.melSennichimae, nankaiA: M.melNankaiA, nankaiB: M.melNankaiB }[p[1]]; ch = fn(sr).channels; break; }
    case 'chime': {
      const res = p[1] === 'discover' ? M.chimeDiscover(sr) : p[1] === 'conbini' ? M.chimeConbini(sr) : p[1] === 'pa' ? M.chimePA(sr, false) : p[1] === 'paend' ? M.chimePA(sr, true) : p[1] === 'door' ? M.chimeDoor(sr) : M.chimeEsc(sr);
      ch = res.channels; break;
    }
    case 'loop': {
      const fn = { tempura: F.tempuraLoop, sizzle: F.sizzleLoop, kitchen: F.kitchenLoop, suitcase: F.suitcaseLoop, escalator: F.escalatorLoop, fridge: F.fridgeLoop }[p[1]];
      ch = mono(fn(sr)); loop = true; break;
    }
    case 'fx': {
      if (p[1] === 'traindist') ch = mono(B.trainDistant(sr, +p[2] || 0));
      else { const fn = { steam: F.steam, grinder: F.grinder, gacha: F.gacha, horn: B.horn, bus: B.busAir }[p[1]]; ch = mono(fn(sr)); }
      break;
    }
    case 'bed': {
      loop = true;
      switch (p[1]) {
        case 'hvac': ch = B.hvac(sr, p[2] || 'tile'); break;
        case 'tunnel': ch = B.tunnel(sr); break;
        case 'gust': ch = mono(F.gust(sr, +p[2] || 0)); loop = false; break;
        case 'traffic': ch = B.traffic(sr); break;
        case 'cityfar': ch = B.cityFar(sr); break;
        case 'leaves': ch = B.leaves(sr); break;
        case 'water': ch = B.water(sr); break;
        case 'walla': ch = mono(walla(sr, 16, +p[2] || 18, 7 + (+p[3] || 0))); break;
        case 'steps': ch = B.stepTexture(sr, p[2] || 'stone'); break;
        default: throw new Error('no bed ' + p[1]);
      }
      break;
    }
    case 'bird': {
      const fn = { bulbul: B.bulbul, sparrow: B.sparrow, whiteeye: B.whiteEye, tit: B.tit, crow: B.crow }[p[1]];
      ch = mono(fn(sr, +p[2] || 0)); break;
    }
    case 'sig': ch = mono(B.crossing(sr, p[1])); loop = true; break;
    case 'tr': {
      switch (p[1]) {
        case 'vvvf': ch = mono(T.vvvf(sr, p[2], +p[3] || 0)); break;
        case 'roll': ch = T.roll(sr); loop = true; break;
        case 'joint': ch = mono(T.joint(sr, +p[2] || 0)); break;
        case 'squeal': ch = mono(T.brakeSqueal(sr, +p[2] || 0)); break;
        case 'air': ch = mono(T.airRelease(sr, +p[2] || 0)); break;
        case 'doors': ch = mono(T.doors(sr, p[2] !== 'close')); break;
        case 'aux': ch = mono(T.auxHum(sr)); loop = true; break;
        default: throw new Error('no train sound ' + p[1]);
      }
      break;
    }
    case 'ir': ch = impulse(sr, p[1]); break;
    default: throw new Error('unknown recipe ' + name);
  }
  return { channels: ch, sampleRate: sr, loop };
}
