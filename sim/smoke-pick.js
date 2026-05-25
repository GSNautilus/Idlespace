// Verify the fixed candidate-picker actually picks Hydroponics (food +8)
// over Spaceport (credits +8) when the colony would otherwise starve.
const E = require('./economy.js');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(__dirname + '/../data/game-cards.json', 'utf8'));
const cardById = {}; for (const c of data.cards) cardById[c.id] = c;

const hydro = cardById['bld_004']; // food +8
const port  = cardById['bld_019']; // credits +8
const solar = cardById['bld_001']; // energy +3

const col = E.makeEmptyColony({ population: 1, activeAction: 'buildings' });
const planet = { card: null };
const weights = { credits: 1, energy: 1, minerals: 1, research: 1, food: 1 };

const baseScore = E.colonyScore(col, planet, weights);
console.log(`empty colony score (buildings action): ${baseScore.toFixed(2)}`);

for (const c of [hydro, port, solar]) {
  col.buildings[0] = c;
  const s = E.colonyScore(col, planet, weights);
  const out = E.getColonyOutput(col, planet);
  col.buildings[0] = null;
  console.log(`  ${c.name.padEnd(20)} score=${s.toFixed(2).padStart(7)}   `
    + `food rate=${out.food.toFixed(1).padStart(5)}   `
    + `starving=${(out.food - 0 < 0 || (E.getColonyOutput({population:1,buildings:[c],leaders:[],activeAction:'buildings'},planet).food < 0))}`);
}

console.log('\nExpected: Hydroponics scores highest because Spaceport/Solar both starve the colony');
console.log('(food maintenance at pop 1 = 1, Spaceport/Solar produce 0 food → starvation → other stats ×0.2).');
