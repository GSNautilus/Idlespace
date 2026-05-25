// Diagnostic — at a specific colony state, print the lookahead score for
// every candidate × slot combo. Helps see WHY the picker prefers what it does.
const E = require('./economy.js');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(__dirname + '/../data/game-cards.json', 'utf8'));
const byId = {}; for (const c of data.cards) byId[c.id] = c;

const HYDRO = byId['bld_004']; // +8 f
const RESEARCH = byId['bld_003']; // +3 r -1 c
const SOLAR = byId['bld_001']; // +3 e
const MINING = byId['bld_002']; // +3 m
const HUB = byId['bld_016']; // +5 c +2 f
const PORT = byId['bld_019']; // +8 c

const LOOKAHEAD_TICKS = 1800;
const weights = { credits: 1, energy: 1, minerals: 1, research: 1, food: 1 };

function makeCol(buildings, pop) {
  return {
    population: pop, maxPopulation: 10,
    buildings: [...buildings, ...new Array(10 - buildings.length).fill(null)],
    leaders: [], activeAction: 'trade', deck: [], queue: [], genTimer: 0,
  };
}

function lookaheadEval(col, planet, resources, candidateCard, slotIdx) {
  const trialCol = {
    population: col.population, maxPopulation: col.maxPopulation,
    buildings: col.buildings.slice(), leaders: col.leaders.slice(),
    activeAction: 'trade', deck: [], queue: [], genTimer: 0,
  };
  if (candidateCard && slotIdx >= 0) trialCol.buildings[slotIdx] = candidateCard;
  const trialRes = { ...resources };
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
        if (proj.food >= 0) { trialRes.credits -= cost.credits; trialRes.food -= cost.food; }
        else trialCol.population -= 1;
      }
    }
  }
  let s = trialCol.population * 20000 + trialUnlocks * 10000;
  const deltas = {};
  for (const id of E.RESOURCE_IDS) {
    deltas[id] = trialRes[id] - resources[id];
    s += (weights[id] || 0) * deltas[id];
  }
  return { score: s, finalPop: trialCol.population, unlocks: trialUnlocks, deltas };
}

// Scenario: pop 3, slot 1-3 = Hydroponics, deciding next pick
console.log('=== Scenario: pop 3, 3 Hydroponics, banks {c:13K, f:47K} ===\n');
const planet = { card: null };
const col = makeCol([HYDRO, HYDRO, HYDRO], 3);
const res = { credits: 13000, energy: 5000, minerals: 5000, research: 0, food: 47000 };

const baseline = lookaheadEval(col, planet, res, null, -1);
console.log(`baseline (no change): score=${baseline.score.toFixed(0).padStart(8)}  finalPop=${baseline.finalPop}  unlocks=${baseline.unlocks}  Δ=${JSON.stringify(baseline.deltas)}`);

const candidates = [
  { name: 'Hydroponics → slot 0', card: HYDRO, slot: 0 },
  { name: 'Research Lab → slot 0', card: RESEARCH, slot: 0 },
  { name: 'Solar Array → slot 0', card: SOLAR, slot: 0 },
  { name: 'Mining Outpost → slot 0', card: MINING, slot: 0 },
  { name: 'Colony Hub → slot 0', card: HUB, slot: 0 },
  { name: 'Spaceport → slot 0', card: PORT, slot: 0 },
];
for (const c of candidates) {
  const r = lookaheadEval(col, planet, res, c.card, c.slot);
  const gain = r.score - baseline.score;
  console.log(`${c.name.padEnd(30)} score=${r.score.toFixed(0).padStart(8)}  finalPop=${r.finalPop}  unlocks=${r.unlocks}  gain=${gain.toFixed(0).padStart(7)}`);
}

console.log('\n=== Scenario 2: pop 1, empty colony, banks {c:5K, f:5K} ===\n');
const col2 = makeCol([], 1);
const res2 = { credits: 5000, energy: 5000, minerals: 5000, research: 0, food: 5000 };
const base2 = lookaheadEval(col2, planet, res2, null, -1);
console.log(`baseline: score=${base2.score.toFixed(0)}  finalPop=${base2.finalPop}  unlocks=${base2.unlocks}`);
for (const c of [HYDRO, RESEARCH, SOLAR, MINING, HUB, PORT]) {
  const r = lookaheadEval(col2, planet, res2, c, 0);
  console.log(`${c.name.padEnd(20)} → slot 0: score=${r.score.toFixed(0).padStart(8)}  finalPop=${r.finalPop}  unlocks=${r.unlocks}  Δ${JSON.stringify(r.deltas)}`);
}
