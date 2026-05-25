// Headless smoke test — verifies pure economy fns + the v1 systems
// (leader bonuses, planet bonuses, scoring, draws) without the browser.
const E = require('./economy.js');
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(__dirname + '/../data/game-cards.json', 'utf8'));
const byCat = { building: [], leader: [], planet: [] };
const cardById = {};
for (const c of data.cards) {
  cardById[c.id] = c;
  if (byCat[c.category]) byCat[c.category].push(c);
}

function run(label, opts) {
  const col = E.makeEmptyColony({ population: opts.pop || 1, activeAction: opts.action || 'trade' });
  for (const id of opts.buildings || []) {
    const idx = col.buildings.indexOf(null);
    if (idx >= 0) col.buildings[idx] = cardById[id];
  }
  if (opts.leader) col.leaders = [cardById[opts.leader]];
  const planet = { card: opts.planet ? cardById[opts.planet] : null };
  const state = {
    resources: E.makeStartingResources(),
    colonies: [{ colony: col, planet }],
  };
  const ticks = opts.ticks || 3600;
  let pops = 0;
  for (let t = 0; t < ticks; t++) {
    E.tickEconomy(state);
    if (col.population < col.maxPopulation) {
      const cost = E.getPopGrowthCost(col.population + 1);
      if (state.resources.credits >= cost.credits && state.resources.food >= cost.food) {
        state.resources.credits -= cost.credits;
        state.resources.food -= cost.food;
        col.population++;
        pops++;
      }
    }
  }
  const out = E.getColonyOutput(col, planet);
  out.credits += E.getTradeIncome(col, out);
  console.log(`\n--- ${label} (${ticks}s, pop ${col.population}, +${pops}) ---`);
  for (const id of E.RESOURCE_IDS) {
    console.log(`  ${id.padEnd(9)} bank=${state.resources[id].toFixed(0).padStart(10)}   rate=${out[id].toFixed(2).padStart(8)}/s`);
  }
}

// 1) baseline empty trade
run('empty/trade', {});

// 2) leader bonus on empty colony — bonuses multiply zero, so leader does nothing
const ldrAllOne = byCat.leader.find(l => {
  const b = l.categoryData && l.categoryData.bonuses;
  return b && Object.keys(b).length === 5;
});
run('leader (all +1%, empty colony) — should ≈ baseline', { leader: ldrAllOne.id });

// 3) common building + leader on planet
const food = byCat.building.find(b => (b.stats||{}).food && b.rarity === 'common');
const mineral = byCat.building.find(b => (b.stats||{}).minerals && b.rarity === 'common');
const energy = byCat.building.find(b => (b.stats||{}).energy && b.rarity === 'common');
const credit = byCat.building.find(b => (b.stats||{}).credits && b.rarity === 'common');
const planet = byCat.planet.find(p => p.rarity === 'common' && (p.categoryData.bonuses||{}).credits);
console.log('\npicked food=' + food.id, 'min=' + mineral.id, 'eng=' + energy.id, 'cre=' + credit.id, 'planet=' + planet.id);

run('balanced common buildings + leader + planet', {
  pop: 4, buildings: [food.id, mineral.id, energy.id, credit.id],
  leader: ldrAllOne.id, planet: planet.id, action: 'trade',
});

// 4) Scoring sanity — score a strong building vs weak
const wgt = { credits: 1, energy: 1, minerals: 1, research: 1, food: 1 };
const strong = byCat.building.find(b => b.rarity === 'legendary');
const weak = byCat.building.find(b => b.rarity === 'common');
console.log('\nscore strong (' + strong.name + '):', E.cardScore(strong, wgt).toFixed(2));
console.log('score weak (' + weak.name + '):', E.cardScore(weak, wgt).toFixed(2));

// 5) colonyScore swap — placing a strong building should raise it
const col2 = E.makeEmptyColony({ population: 1, activeAction: 'trade' });
const baseScore = E.colonyScore(col2, { card: null }, wgt);
col2.buildings[0] = strong;
const newScore = E.colonyScore(col2, { card: null }, wgt);
console.log(`\ncolonyScore empty=${baseScore.toFixed(2)}  with ${strong.name}=${newScore.toFixed(2)}  Δ=${(newScore-baseScore).toFixed(2)}`);

console.log('\nAll OK.');
