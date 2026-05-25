// Extract sim.html's inline script and try to parse it. Stubs browser globals
// just enough for `new Function(...)` to compile.
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../sim.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!m) { console.log('no inline script found'); process.exit(1); }

const stub = `
  const SimEconomy = { RESOURCE_IDS:[], RARITY_WEIGHTS:{}, POP_LEVELS:[],
    makeEmptyColony: () => ({ buildings: [], leaders: [], deck: [], genTimer: 0, activeAction: 'trade' }),
    makeStartingResources: () => ({}),
    getColonyOutput: () => ({}), getTradeIncome: () => 0,
    getResearchCost: () => 0, getDrawScaling: () => ({ cost: 0, interval: 1 }),
    getColonyGenInterval: () => 1, getPopGrowthCost: () => ({}),
    countColonyCards: () => 0,
    cardScore: () => 0, colonyScore: () => 0,
    tickEconomy: () => {},
  };
  const document = {
    getElementById: () => ({
      value: '0', checked: false, textContent: '', innerHTML: '',
      addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [],
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      appendChild: () => {}, focus: () => {}, getContext: () => ({
        scale: () => {}, clearRect: () => {}, beginPath: () => {}, moveTo: () => {},
        lineTo: () => {}, stroke: () => {}, fillText: () => {},
      }),
      clientWidth: 100, clientHeight: 100,
    }),
    documentElement: { },
  };
  const window = { addEventListener: () => {}, devicePixelRatio: 1 };
  const fetch = () => ({ then: () => ({ then: () => ({ catch: () => {} }), catch: () => {} }) });
  const getComputedStyle = () => ({ getPropertyValue: () => '' });
`;
try {
  new Function(stub + m[1]);
  console.log('sim.html inline script: parses OK');
} catch (e) {
  console.log('PARSE ERROR:', e.message);
  process.exit(1);
}
