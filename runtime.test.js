import { WebRuntime } from './runtime.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function runSmokeTest() {
  const rules = {
    metadata: {
      deck: { ranks: ['A', 'K'], suits: ['H'] },
      setup: { initialHandSize: 1, shuffle: false },
      cardValues: { A: 1, K: 10 },
      cardAbilities: { KH: 'peek' },
    },
    actions: {
      draw: { id: 'draw', allowedPhases: ['main_turn'], effects: [{ op: 'moveCard', from: 'deck', to: 'currentPlayer.hand' }] },
      burn: { id: 'burn', allowedPhases: ['main_turn'], effects: [{ op: 'moveCardByIndex', from: 'currentPlayer.hand', to: 'discard', param: 'handIndex' }] },
    },
    abilities: {
      peek: {
        id: 'peek',
        allowedPhases: ['main_turn'],
        effects: [{ op: 'revealCard', target: 'currentPlayer', handIndexParam: 'handIndex' }],
      },
    },
  };

  const runtime = new WebRuntime({ rules, seed: 'test' });
  const state = runtime.initState({ players: [{ id: 1 }, { id: 2 }], shuffle: false });

  assert(state.players[0].hand.length === 1, 'Initial hand should draw 1 card');
  assert(state.deck.length === 3, 'Deck should contain remaining cards');

  const drawResult = runtime.executeAction({ state, playerId: 1, actionId: 'draw' });
  assert(drawResult.state.players[0].hand.length === 2, 'Draw should add a card');

  const abilityResult = runtime.executeAbility({ state, playerId: 1, abilityId: 'peek', params: { handIndex: 0 } });
  assert(abilityResult.events.some((e) => e.type === 'card_reveal'), 'Peek should reveal a card');

  const burnResult = runtime.executeAction({ state, playerId: 1, actionId: 'burn', params: { handIndex: 0 } });
  assert(burnResult.state.discard.length === 1, 'Burn should place a card into discard');

  console.log('Smoke test passed');
}

runSmokeTest();
