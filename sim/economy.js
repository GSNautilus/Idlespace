// IdleSpace economy simulator — pure functions and constants ported from
// starmap.html. No DOM, no game-side globals. Loadable in browser via
// <script src="sim/economy.js"> (exposes window.SimEconomy) or in Node.
//
// Source-of-truth functions in starmap.html (as of v0.1.3):
//   RESOURCE_DEFS/IDS, STARTING_RESOURCES, POP_LEVELS              ~L7341-7414
//   draw scaling constants + EXPECTED_PER_COLONY                   ~L7396-7400
//   RESEARCH_* constants                                           ~L7450-7452
//   getFoodMaintenance, getPopGrowthCost                           ~L7421-7432
//   getDrawScaling, getColonyGenInterval                           ~L8073-8096
//   getTradeIncome, getTerraformIncome, getColonyOutput            ~L8115-8198
//   getColonizationCost                                            ~L8416-8430
//
// If you change the math here, keep starmap.html in sync (or move starmap.html
// to load this file — see README in sim.html).

(function () {
  const RESOURCE_DEFS = [
    { id: "credits",  name: "Credits"  },
    { id: "energy",   name: "Energy"   },
    { id: "minerals", name: "Minerals" },
    { id: "research", name: "Research" },
    { id: "food",     name: "Food"     },
  ];
  const RESOURCE_IDS = RESOURCE_DEFS.map(r => r.id);

  const STARTING_RESOURCES = { credits: 5000, energy: 5000, minerals: 5000, research: 0, food: 5000 };

  const TICK_PERIOD = 1; // game-seconds per resource tick

  const TRADE_BASE_CREDITS = 5;
  const TERRAFORM_BASE_FOOD = 5;

  // Draw scaling
  const BASE_DRAW_COST     = 500;
  const BASE_DRAW_INTERVAL = 30;
  const DRAW_K_C = 1.25;
  const DRAW_K_E = 0.75;
  const EXPECTED_PER_COLONY = { building: 10, ship: 5, captain: 3, admiral: 3, leader: 1 };
  const DRAW_STACK_PENALTY = 5;

  // Research
  const RESEARCH_BASE_COST = 500;
  const RESEARCH_COST_MULTIPLIER = 2.0;
  const RESEARCH_SPEND_RATE = 5;

  const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };

  const POP_LEVELS = [
    { level: 1,  label: "100K", people: 100000,            foodMaint: 1  },
    { level: 2,  label: "1M",   people: 1000000,           foodMaint: 3  },
    { level: 3,  label: "10M",  people: 10000000,          foodMaint: 6  },
    { level: 4,  label: "100M", people: 100000000,         foodMaint: 10 },
    { level: 5,  label: "500M", people: 500000000,         foodMaint: 15 },
    { level: 6,  label: "1B",   people: 1000000000,        foodMaint: 22 },
    { level: 7,  label: "5B",   people: 5000000000,        foodMaint: 30 },
    { level: 8,  label: "50B",  people: 50000000000,       foodMaint: 42 },
    { level: 9,  label: "200B", people: 200000000000,      foodMaint: 58 },
    { level: 10, label: "1T",   people: 1000000000000,     foodMaint: 80 },
  ];

  function getFoodMaintenance(pop) {
    const entry = POP_LEVELS[Math.min(pop, POP_LEVELS.length) - 1];
    return entry ? entry.foodMaint : 0;
  }

  function getPopGrowthCost(nextLevel) {
    const k = Math.pow(2, nextLevel - 1);
    return {
      credits: Math.ceil(2500 * k),
      food:    Math.ceil(1250 * k),
    };
  }

  // colonyCount = number of colonies already owned. First colony is free.
  // artifactDiscountPercent: linear stack of colonyShipDiscount artifacts (capped 90%).
  function getColonizationCost(colonyCount, artifactDiscountPercent) {
    if (colonyCount === 0) return {};
    const n = colonyCount;
    const k = n <= 4 ? n : 4 * Math.pow(2, n - 4);
    const cappedDiscount = Math.min(0.9, Math.max(0, (artifactDiscountPercent || 0) / 100));
    const discount = Math.max(0.1, 1 - cappedDiscount);
    return {
      credits:  Math.ceil(10000 * k * discount),
      minerals: Math.ceil( 5000 * k * discount),
      food:     Math.ceil( 1000 * k * discount),
    };
  }

  // empireCardCount: passed in (sim provides; game's countEmpireCards stays
  // game-side because it walks mapEntities for ships/admirals).
  function getDrawScaling(col, category, empireCardCount) {
    const expected = EXPECTED_PER_COLONY[category] || 5;
    const cC = countColonyCards(col, category);
    const cE = empireCardCount != null ? empireCardCount : cC;
    const loadC = cC / expected;
    const loadE = cE / expected;
    const mult  = Math.pow(1 + loadC, DRAW_K_C) * Math.pow(1 + loadE, DRAW_K_E);
    return {
      cost:     Math.ceil(BASE_DRAW_COST * mult),
      interval: BASE_DRAW_INTERVAL * mult,
      cC, cE, mult,
    };
  }

  function getColonyGenInterval(col, category, empireCardCount) {
    const base = getDrawScaling(col, category, empireCardCount).interval;
    const stack = (col && col.deck) ? col.deck.length : 0;
    return base * Math.pow(DRAW_STACK_PENALTY, stack);
  }

  // Simplified counter — matches starmap.html's countColonyCards but without
  // the ACTION_TO_CATEGORY fallback for ambiguous face-down deck cards.
  function countColonyCards(col, category) {
    if (!col) return 0;
    let n = 0;
    if (category === "building") {
      for (const b of col.buildings || []) if (b) n++;
    } else if (category === "leader") {
      for (const l of col.leaders || []) if (l) n++;
    }
    for (const q of col.queue || []) if (q && q.category === category) n++;
    for (const d of col.deck  || []) if (d && d.category === category) n++;
    return n;
  }

  function getTradeIncome(colony, output) {
    if (!colony.activeAction || colony.activeAction !== "trade") return 0;
    let total = 0;
    for (const id of RESOURCE_IDS) {
      if (id === "credits") continue;
      total += Math.max(0, output[id] || 0);
    }
    return TRADE_BASE_CREDITS + total / 4;
  }

  // artifactBonuses shape: { perColony: {id:amount}, perTick: {id:amount},
  //                          researchMul: percent, colonyDiscount: percent,
  //                          sensorMul, fleetSize }
  // Defaults to no bonuses.
  const NO_ARTIFACTS = { perColony: {}, perTick: {}, researchMul: 0, colonyDiscount: 0 };

  function getColonyOutput(colony, planet, artifactBonuses) {
    const arts = artifactBonuses || NO_ARTIFACTS;
    const raw = {};
    for (const id of RESOURCE_IDS) raw[id] = 0;

    // Buildings (only in unlocked slots — bounded by population)
    for (let i = 0; i < colony.population; i++) {
      const b = colony.buildings[i];
      if (b && b.stats) for (const id of RESOURCE_IDS) raw[id] += (b.stats[id] || 0);
      if (b && b.upkeep) for (const id of RESOURCE_IDS) raw[id] -= (b.upkeep[id] || 0);
    }
    // Leader flats
    for (const l of (colony.leaders || [])) {
      if (l && l.stats)  for (const id of RESOURCE_IDS) raw[id] += (l.stats[id]  || 0);
      if (l && l.upkeep) for (const id of RESOURCE_IDS) raw[id] -= (l.upkeep[id] || 0);
    }
    // Leader % bonuses (multiplicative).
    // Templates carry bonuses in categoryData.bonuses; the game hoists rolled
    // values to l.bonuses at draw time. We read either path so the sim works
    // with raw templates AND game-hoisted cards.
    for (const l of (colony.leaders || [])) {
      const lb = l && ((l.categoryData && l.categoryData.bonuses) || l.bonuses);
      if (lb) for (const id of RESOURCE_IDS) if (lb[id]) raw[id] *= (1 + lb[id] / 100);
    }
    // Planet % bonuses (compound on top of leader bonuses) — same dual-path.
    const planetBonuses = planet && planet.card && (
      (planet.card.categoryData && planet.card.categoryData.bonuses) || planet.card.bonuses
    );
    if (planetBonuses) {
      for (const id of RESOURCE_IDS) {
        if (planetBonuses[id]) raw[id] *= (1 + planetBonuses[id] / 100);
      }
    }
    // Artifact flatResourcePerColony
    const perColony = arts.perColony || {};
    for (const id of RESOURCE_IDS) raw[id] += (perColony[id] || 0);

    // Terraform folds into raw food BEFORE starvation check
    if (colony.activeAction === "terraform") {
      let total = 0;
      for (const id of RESOURCE_IDS) {
        if (id === "food") continue;
        total += Math.max(0, raw[id] || 0);
      }
      raw.food += TERRAFORM_BASE_FOOD + total / 4;
    }
    // Starvation: 1/5 non-food production while food rate is negative
    const maintenance = getFoodMaintenance(colony.population);
    const starving = (raw.food - maintenance) < 0;
    const out = {};
    for (const id of RESOURCE_IDS) {
      out[id] = raw[id] * (starving && id !== "food" ? 0.2 : 1);
    }
    out.food -= maintenance;
    return out;
  }

  // Convenience: apply one tick to a sim state. Mutates state.resources.
  // state = { resources, colonies: [{ colony, planet }], artifactBonuses?, activeResearch? }
  function tickEconomy(state) {
    const arts = state.artifactBonuses || NO_ARTIFACTS;
    for (const c of state.colonies) {
      const out = getColonyOutput(c.colony, c.planet, arts);
      for (const id of RESOURCE_IDS) state.resources[id] += (out[id] || 0);
      state.resources.credits += getTradeIncome(c.colony, out);
    }
    const perTick = arts.perTick || {};
    for (const id of RESOURCE_IDS) state.resources[id] += (perTick[id] || 0);

    // Research spend (capped per tick)
    if (state.activeResearch && state.resources.research > 0) {
      const spendRate = RESEARCH_SPEND_RATE * (1 + (arts.researchMul || 0) / 100);
      const spend = Math.min(
        spendRate,
        state.resources.research,
        state.activeResearch.cost - state.activeResearch.progress
      );
      if (spend > 0) {
        state.resources.research -= spend;
        state.activeResearch.progress += spend;
        if (state.activeResearch.progress >= state.activeResearch.cost) {
          state.activeResearch.completed = (state.activeResearch.completed || 0) + 1;
          state.activeResearch.progress = 0;
        }
      }
    }
  }

  function getResearchCost(nonTechCount) {
    return Math.ceil(RESEARCH_BASE_COST * Math.pow(RESEARCH_COST_MULTIPLIER, nonTechCount));
  }

  function makeStartingResources() {
    const r = {};
    for (const id of RESOURCE_IDS) r[id] = STARTING_RESOURCES[id] != null ? STARTING_RESOURCES[id] : 0;
    return r;
  }

  // Weighted score of a single card. Pure heuristic used by sim policies:
  //   score = Σ weight[r] × (stats[r] − upkeep[r])
  //         + Σ weight[r] × contextOutput[r] × bonus[r] / 100   // for %-bonus cards
  // For buildings the first sum dominates (flat stats). For leaders/planets
  // the second sum dominates (% multiplier on existing output) — contextOutput
  // is the colony's current per-tick output, so a leader gets a higher score
  // on a strong colony than on an empty one (which matches play).
  function cardScore(card, weights, contextOutput) {
    if (!card) return 0;
    let s = 0;
    const bonuses = (card.categoryData && card.categoryData.bonuses) || card.bonuses;
    for (const id of RESOURCE_IDS) {
      const w = weights ? (weights[id] || 0) : 1;
      const flat = ((card.stats && card.stats[id]) || 0) - ((card.upkeep && card.upkeep[id]) || 0);
      s += w * flat;
      if (bonuses && bonuses[id]) {
        const base = (contextOutput && contextOutput[id]) || 0;
        s += w * base * bonuses[id] / 100;
      }
    }
    return s;
  }

  // Weighted sum of a colony's current per-tick output. Used by the sim's
  // slot-placement decision: temporarily swap a card in, compare colony scores,
  // pick whichever placement yields higher weighted output.
  function colonyScore(colony, planet, weights, artifactBonuses) {
    const out = getColonyOutput(colony, planet, artifactBonuses);
    let s = 0;
    for (const id of RESOURCE_IDS) s += (weights ? (weights[id] || 0) : 1) * (out[id] || 0);
    // Include trade income in the weighted credit term so policies that toggle
    // to trade get scored fairly.
    if (colony.activeAction === "trade") {
      s += (weights ? (weights.credits || 0) : 1) * getTradeIncome(colony, out);
    }
    return s;
  }

  function makeEmptyColony(opts) {
    return {
      population: (opts && opts.population) || 1,
      maxPopulation: 10,
      buildings: new Array(10).fill(null),
      leaders: [],
      activeAction: (opts && opts.activeAction) || "trade",
      deck: [],
      queue: [],
      genTimer: 0,
    };
  }

  const api = {
    RESOURCE_DEFS, RESOURCE_IDS, STARTING_RESOURCES, TICK_PERIOD,
    TRADE_BASE_CREDITS, TERRAFORM_BASE_FOOD,
    BASE_DRAW_COST, BASE_DRAW_INTERVAL, DRAW_K_C, DRAW_K_E,
    EXPECTED_PER_COLONY, DRAW_STACK_PENALTY,
    RESEARCH_BASE_COST, RESEARCH_COST_MULTIPLIER, RESEARCH_SPEND_RATE,
    RARITY_WEIGHTS, POP_LEVELS,
    getFoodMaintenance, getPopGrowthCost, getColonizationCost,
    countColonyCards, getDrawScaling, getColonyGenInterval,
    getTradeIncome, getColonyOutput, tickEconomy,
    getResearchCost, makeStartingResources, makeEmptyColony,
    cardScore, colonyScore,
    NO_ARTIFACTS,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalThis.SimEconomy = api;
  }
})();
