// Full-flow smoke: mirrors sim.html's runSim() in node so we can trace what
// actually happens minute-by-minute. Run: node sim/smoke-full.js
const E = require('./economy.js');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(__dirname + '/../data/game-cards.json', 'utf8'));

const allCards = data.cards;
const byCategory = { building: [], leader: [], planet: [], ship: [], admiral: [] };
const cardById = {};
for (const c of allCards) {
  cardById[c.id] = c;
  if (byCategory[c.category]) byCategory[c.category].push(c);
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(opts) {
  opts = opts || {};
  const seed = opts.seed || 1;
  const hours = opts.hours || 1;
  const policy = opts.policy || 'smart';
  const autoPop = opts.autoPop !== false;
  const startPop = opts.startPop || 1;
  const weights = opts.weights || { credits: 1, energy: 1, minerals: 1, research: 1, food: 1 };
  const verbose = opts.verbose !== false;

  const rng = mulberry32(seed);

  const col = E.makeEmptyColony({ population: startPop, activeAction: policy === 'smart' ? 'trade' : policy });
  const planet = { card: null };
  const state = { resources: E.makeStartingResources(), colonies: [{ colony: col, planet }], activeResearch: null };

  const researched = new Set();
  for (const c of allCards) {
    if (c.rarity !== 'common') continue;
    if (c.category === 'tech' || c.category === 'artifact' || c.category === 'star' || c.category === 'planet') continue;
    if ((c.tags || []).includes('non-starter')) continue;
    researched.add(c.id);
  }
  const researchCounts = { building: 0, ship: 0, admiral: 0, leader: 0, tech: 0, artifact: 0 };
  state.activeResearch = { cost: E.getResearchCost(0), progress: 0, completed: 0 };
  let researchPrevCompleted = 0;

  const events = [];
  const log = (t, msg) => { events.push({ t, msg }); if (verbose) console.log('  [' + String(t).padStart(5) + 's]', msg); };

  let lastDiscardKey = null;
  const stateKey = () => col.population + '|' + col.buildings.map(b => b ? b.id : '_').join(',') + '|' + researched.size;

  function rollOne(pool) {
    let total = 0;
    const ws = pool.map(c => {
      const w = (E.RARITY_WEIGHTS[c.rarity] || 0) * (c.weight != null ? c.weight : 1);
      total += w;
      return w;
    });
    if (total === 0) return null;
    let r = rng() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= ws[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }
  function roll3(pool) {
    const picks = []; const seen = new Set();
    let tries = 0;
    while (picks.length < 3 && tries < 30) {
      tries++;
      const c = rollOne(pool);
      if (c && !seen.has(c.id)) { seen.add(c.id); picks.push(c); }
    }
    return picks;
  }

  const LOOKAHEAD_TICKS = 1800;

  function lookaheadEval(candidateCard, slotIdx) {
    const trialCol = {
      population: col.population, maxPopulation: col.maxPopulation,
      buildings: col.buildings.slice(), leaders: col.leaders.slice(),
      activeAction: 'trade', deck: [], queue: [], genTimer: 0,
    };
    if (candidateCard && slotIdx >= 0) trialCol.buildings[slotIdx] = candidateCard;
    const trialRes = { ...state.resources };
    let trialUnlocks = 0;
    const ar = { cost: E.getResearchCost(trialUnlocks), progress: 0, completed: 0 };
    let prevCompleted = 0;
    const trialState = {
      resources: trialRes,
      colonies: [{ colony: trialCol, planet }],
      activeResearch: ar,
    };

    for (let t = 0; t < LOOKAHEAD_TICKS; t++) {
      E.tickEconomy(trialState);
      if (ar.completed > prevCompleted) {
        trialUnlocks += (ar.completed - prevCompleted);
        prevCompleted = ar.completed;
        ar.cost = E.getResearchCost(trialUnlocks);
      }
      if (trialCol.population < trialCol.maxPopulation) {
        const cost = E.getPopGrowthCost(trialCol.population + 1);
        if (trialRes.credits >= cost.credits && trialRes.food >= cost.food) {
          trialCol.population += 1;
          const proj = E.getColonyOutput(trialCol, planet);
          const postBuyFood = trialRes.food - cost.food;
          const deficit = proj.food < 0 ? -proj.food : 0;
          const okay = proj.food >= 0 || postBuyFood >= 3600 * deficit;
          if (okay) {
            trialRes.credits -= cost.credits;
            trialRes.food -= cost.food;
          } else {
            trialCol.population -= 1;
          }
        }
      }
    }
    let s = trialCol.population * 20000 + trialUnlocks * 10000;
    for (const id of E.RESOURCE_IDS) {
      const delta = trialRes[id] - state.resources[id];
      s += (weights[id] || 0) * delta;
      if (trialRes[id] < 0) s += (weights[id] || 0) * trialRes[id] * 10;
    }
    return s;
  }
  const REPLACE_THRESHOLD = 10000;
  function pickBestCandidate(candidates) {
    const baseScore = lookaheadEval(null, -1);
    let best = null, bestSlot = -1, bestScore = baseScore, bestIsReplace = false;
    for (const c of candidates) {
      for (let i = 0; i < col.population; i++) {
        const isEmpty = col.buildings[i] === null;
        const s = lookaheadEval(c, i);
        const minScore = isEmpty ? bestScore : bestScore + REPLACE_THRESHOLD;
        if (s > minScore || (s > bestScore && isEmpty && !bestIsReplace)) {
          best = c; bestSlot = i; bestScore = s; bestIsReplace = !isEmpty;
        }
      }
    }
    return { card: best, slot: bestSlot, gain: bestScore - baseScore };
  }

  function tryPopDeck(t) {
    if (col.deck.length === 0) return;
    const scaling = E.getDrawScaling(col, 'building', E.countColonyCards(col, 'building'));
    if (state.resources.credits < scaling.cost) return;
    const pool = byCategory.building.filter(c => researched.has(c.id));
    if (pool.length === 0) { col.deck.shift(); return; }
    state.resources.credits -= scaling.cost;
    col.deck.shift();
    const cands = roll3(pool);
    const pick = pickBestCandidate(cands);
    if (pick.card) {
      const replaced = col.buildings[pick.slot];
      col.buildings[pick.slot] = pick.card;
      lastDiscardKey = null;
      log(t, `Drew ${pick.card.name} → slot ${pick.slot + 1}` + (replaced ? ` (replaced ${replaced.name})` : '') + ` cost=${scaling.cost.toFixed(0)}c`);
    } else {
      lastDiscardKey = stateKey();
      log(t, `Discarded (no improvement from: ${cands.map(c=>c.name).join(', ')}); ${scaling.cost.toFixed(0)}c sunk`);
    }
  }

  function pickAction() {
    if (policy !== 'smart') return policy;
    const scaling = E.getDrawScaling(col, 'building', E.countColonyCards(col, 'building'));
    if (state.resources.credits < scaling.cost) return 'trade';
    if (lastDiscardKey === stateKey()) return 'trade';
    return 'buildings';
  }

  // Roll a non-tech research candidate. Real game distribution: 66% tech, 34%
  // non-tech split [3,3,3,3,2] across building/ship/admiral/leader/artifact.
  // Per user rule, sim ALWAYS picks highest-scoring non-tech (skip cycle if 0).
  const NONTECH_WEIGHTS = { building: 3, ship: 3, admiral: 3, leader: 3 };
  function rollResearchSlot() {
    if (rng() < 0.66) return { isTech: true };
    let total = 0;
    for (const k in NONTECH_WEIGHTS) total += NONTECH_WEIGHTS[k];
    let r = rng() * total;
    let chosenCat = 'building';
    for (const k in NONTECH_WEIGHTS) {
      r -= NONTECH_WEIGHTS[k];
      if (r <= 0) { chosenCat = k; break; }
    }
    const pool = (byCategory[chosenCat] || []).filter(c => !researched.has(c.id));
    const pick = rollOne(pool.length ? pool : byCategory[chosenCat]);
    return pick ? { isTech: false, card: pick } : { isTech: true };
  }

  const totalTicks = Math.floor(hours * 3600);
  for (let t = 0; t < totalTicks; t++) {
    col.activeAction = pickAction();
    E.tickEconomy(state);

    // Research completion → unlock + new cycle
    if (state.activeResearch && state.activeResearch.completed > researchPrevCompleted) {
      researchPrevCompleted = state.activeResearch.completed;
      const slots = [rollResearchSlot(), rollResearchSlot(), rollResearchSlot()];
      const nonTech = slots.filter(s => !s.isTech && s.card);
      if (nonTech.length === 0) {
        log(t, `Research wasted (all 3 tech)`);
      } else {
        let bestC = nonTech[0].card;
        for (let i = 1; i < nonTech.length; i++) {
          if ((E.RARITY_WEIGHTS[nonTech[i].card.rarity] || 0) > (E.RARITY_WEIGHTS[bestC.rarity] || 0)) {
            bestC = nonTech[i].card;
          }
        }
        researched.add(bestC.id);
        researchCounts[bestC.category]++;
        log(t, `Researched ${bestC.name} [${bestC.rarity}/${bestC.category}]`);
      }
      const nonTechTotal = researchCounts.building + researchCounts.ship +
                           researchCounts.admiral + researchCounts.leader + researchCounts.artifact;
      state.activeResearch = { cost: E.getResearchCost(nonTechTotal), progress: 0, completed: 0 };
      researchPrevCompleted = 0;
    }

    if (col.activeAction === 'buildings') {
      const interval = E.getColonyGenInterval(col, 'building', E.countColonyCards(col, 'building'));
      col.genTimer += 1;
      if (col.genTimer >= interval) { col.genTimer -= interval; col.deck.push({ category: 'building' }); }
    }
    tryPopDeck(t);
    if (autoPop && col.population < col.maxPopulation) {
      const cost = E.getPopGrowthCost(col.population + 1);
      if (state.resources.credits >= cost.credits && state.resources.food >= cost.food) {
        col.population += 1;
        const projected = E.getColonyOutput(col, planet);
        col.population -= 1;
        const postBuyFood = state.resources.food - cost.food;
        const deficit = projected.food < 0 ? -projected.food : 0;
        const okay = projected.food >= 0 || postBuyFood >= 3600 * deficit;
        if (okay) {
          state.resources.credits -= cost.credits;
          state.resources.food -= cost.food;
          col.population += 1;
          log(t, `POP → ${col.population} (food ${projected.food.toFixed(1)}/s` +
            (projected.food < 0 ? `, buffer ${(postBuyFood/3600).toFixed(0)}h` : '') + ')');
        }
      }
    }
  }

  const out = E.getColonyOutput(col, planet);
  out.credits += E.getTradeIncome(col, out);
  return { col, state, out, events };
}

console.log('=== Default scenario: pop 1, smart toggle, autopop, seed 1, 1h ===');
const r = simulate({ hours: 1, verbose: true });
console.log('\nFINAL: pop=' + r.col.population, 'action=' + r.col.activeAction);
console.log('  slots:', r.col.buildings.map(b => b ? b.name : '—').join(', '));
console.log('  bank:', JSON.stringify(Object.fromEntries(E.RESOURCE_IDS.map(id => [id, Math.round(r.state.resources[id])]))));
console.log('  rate:', JSON.stringify(Object.fromEntries(E.RESOURCE_IDS.map(id => [id, +r.out[id].toFixed(2)]))));

console.log('\n=== 24h, seed 1, last 30 events ===');
const r24 = simulate({ hours: 24, verbose: false });
const last30 = r24.events.slice(-30);
for (const e of last30) console.log('  [' + String(e.t).padStart(5) + 's]', e.msg);
console.log('FINAL: pop=' + r24.col.population, 'action=' + r24.col.activeAction);
console.log('  slots:', r24.col.buildings.map(b => b ? b.name : '—').join(', '));
console.log('  bank:', JSON.stringify(Object.fromEntries(E.RESOURCE_IDS.map(id => [id, Math.round(r24.state.resources[id])]))));
console.log('  total events:', r24.events.length);

console.log('\n=== 24h, weights {credits:2, rest:1}, seed 1 ===');
const r24c = simulate({ hours: 24, verbose: false, weights: { credits: 2, energy: 1, minerals: 1, research: 1, food: 1 } });
console.log('FINAL: pop=' + r24c.col.population, 'action=' + r24c.col.activeAction);
console.log('  slots:', r24c.col.buildings.map(b => b ? b.name : '—').join(', '));
console.log('  bank:', JSON.stringify(Object.fromEntries(E.RESOURCE_IDS.map(id => [id, Math.round(r24c.state.resources[id])]))));
console.log('  rate:', JSON.stringify(Object.fromEntries(E.RESOURCE_IDS.map(id => [id, +r24c.out[id].toFixed(2)]))));
