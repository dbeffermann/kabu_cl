/**
 * Runtime web data-driven alineado con GAME_SCHEMA.md
 * Ejecuta acciones/habilidades definidas en JSON sobre un estado mutable en memoria.
 */
export class WebRuntime {
  constructor({ rules, rng, seed, logger } = {}) {
    this.rules = rules || {};
    this.rng = rng || (seed != null ? createSeededRng(seed) : () => Math.random());
    this.logger = logger || (() => {});

    this.effectHandlers = {
      moveCard: this.handleMoveCard.bind(this),
      moveCardByIndex: this.handleMoveCardByIndex.bind(this),
      setFlag: this.handleSetFlag.bind(this),
      advanceTurnOrder: this.handleAdvanceTurnOrder.bind(this),
      resetTurnFlags: this.handleResetTurnFlags.bind(this),
      setPhase: this.handleSetPhase.bind(this),
      log: this.handleLog.bind(this),
      revealAllHands: this.handleRevealAllHands.bind(this),
      scoreRound: this.handleScoreRound.bind(this),
      if: this.handleIf.bind(this),
      runAbilityForCard: this.handleRunAbilityForCard.bind(this),
      swapCards: this.handleSwapCards.bind(this),
      swapCardsWithPeek: this.handleSwapCardsWithPeek.bind(this),
      revealCard: this.handleRevealCard.bind(this),
    };
  }

  initState({ players, deck: deckOverride, shuffle } = {}) {
    const meta = this.rules.metadata || {};
    const deckConf = meta.deck || {};
    const ranks = deckConf.ranks || [];
    const suits = deckConf.suits || [];

    const deck = deckOverride ? [...deckOverride] : this.buildDeck({ ranks, suits });
    const shouldShuffle = shuffle ?? meta.setup?.shuffle ?? true;
    if (shouldShuffle) this.shuffle(deck);

    const initialHandSize = meta.setup?.initialHandSize || 4;
    const playerStates = players.map((player, idx) => ({
      id: player.id ?? idx + 1,
      name: player.name || `Player ${idx + 1}`,
      hand: deck.splice(0, initialHandSize),
      known: new Array(initialHandSize).fill(false),
      declaredKabu: false,
      hasJustDrawn: false,
      lastDrawSource: null,
      lastDrawCardCode: null,
      score: 0,
    }));

    const state = {
      deck,
      discard: [],
      players: playerStates,
      turn: {
        phaseId: meta.setup?.initialPhaseId || 'main_turn',
        currentPlayerIndex: 0,
        hasDrawn: false,
        justBurned: false,
        hasUsedAbility: false,
        hasDiscarded: false,
      },
      round: { number: 1 },
      match: { hasWinner: false, winnerId: null },
      log: [],
      events: [],
    };

    return state;
  }

  buildDeck({ ranks, suits }) {
    const cards = [];
    suits.forEach((s) => {
      ranks.forEach((r) => cards.push(`${r}${s}`));
    });
    return cards;
  }

  shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  getAvailableActions({ state, playerId }) {
    const actions = this.rules.actions || {};
    const available = [];
    Object.values(actions).forEach((action) => {
      if (!this.isActionAllowed({ state, playerId, action })) return;
      available.push(action.id);
    });
    return available;
  }

  isActionAllowed({ state, playerId, action }) {
    const phaseOk = !action.allowedPhases || action.allowedPhases.includes(state.turn.phaseId);
    if (!phaseOk) return false;

    const conds = action.conditions || [];
    return conds.every((expr) => this.evaluateCondition({ expr, state, playerId }));
  }

  executeAction({ state, playerId, actionId, params = {} }) {
    const action = this.rules.actions?.[actionId];
    if (!action) throw new Error(`Acción no encontrada: ${actionId}`);
    if (!this.isActionAllowed({ state, playerId, action })) {
      throw new Error(`Acción no permitida en fase ${state.turn.phaseId}`);
    }

    const events = [];
    const ctx = { state, playerId, params, events };
    (action.effects || []).forEach((effect) => this.applyEffect(effect, ctx));
    return { state, events };
  }

  executeAbility({ state, playerId, abilityId, params = {} }) {
    const ability = this.rules.abilities?.[abilityId];
    if (!ability) throw new Error(`Habilidad no encontrada: ${abilityId}`);
    const allowed = (ability.allowedPhases || []).length === 0 || ability.allowedPhases.includes(state.turn.phaseId);
    if (!allowed) throw new Error(`Habilidad no permitida en fase ${state.turn.phaseId}`);

    const conds = ability.conditions || [];
    conds.forEach((expr) => {
      if (!this.evaluateCondition({ expr, state, playerId, abilityContext: params })) {
        throw new Error(`Condición no satisfecha para habilidad ${abilityId}`);
      }
    });

    const events = [];
    const ctx = { state, playerId, params, events, abilityContext: params };
    (ability.effects || []).forEach((effect) => this.applyEffect(effect, ctx));
    return { state, events };
  }

  applyEffect(effect, ctx) {
    const op = effect.op || effect.type;
    const handler = this.effectHandlers[op];
    if (!handler) throw new Error(`Operación no soportada: ${op}`);
    handler(effect, ctx);
  }

  handleMoveCard(effect, ctx) {
    const { state } = ctx;
    const count = effect.count ?? 1;
    for (let i = 0; i < count; i += 1) {
      const card = this.extractFrom(state, effect.from, ctx.playerId, effect.param, ctx.params);
      if (card) this.pushTo(state, effect.to, ctx.playerId, card);
    }
  }

  handleMoveCardByIndex(effect, ctx) {
    const { state } = ctx;
    const idx = ctx.params?.[effect.param];
    const card = this.extractFrom(state, effect.from, ctx.playerId, null, ctx.params, idx);
    if (card) this.pushTo(state, effect.to, ctx.playerId, card);
  }

  handleSetFlag(effect, ctx) {
    const target = this.resolveTarget(ctx.state, ctx.playerId, effect.target);
    target[effect.flag] = effect.value;
  }

  handleAdvanceTurnOrder(effect, ctx) {
    const { state } = ctx;
    const next = (state.turn.currentPlayerIndex + 1) % state.players.length;
    state.turn.currentPlayerIndex = next;
    state.turn.phaseId = effect.phaseId || state.turn.phaseId;
    this.handleResetTurnFlags(effect, ctx);
  }

  handleResetTurnFlags(effect, ctx) {
    const { state } = ctx;
    state.turn.hasDrawn = false;
    state.turn.justBurned = false;
    state.turn.hasUsedAbility = false;
    state.turn.hasDiscarded = false;
  }

  handleSetPhase(effect, ctx) {
    ctx.state.turn.phaseId = effect.phaseId;
  }

  handleLog(effect, ctx) {
    const { state, playerId, params } = ctx;
    const template = effect.template || '';
    const player = this.resolvePlayer(state, playerId, 'currentPlayer');
    const text = template
      .replace('{player}', player?.name || `Player ${playerId}`)
      .replace('{param}', JSON.stringify(params));
    state.log.push(text);
    this.logger(text);
  }

  handleRevealAllHands(effect, ctx) {
    ctx.state.players.forEach((p) => {
      p.known = new Array(p.hand.length).fill(true);
      ctx.events?.push({ type: 'hand_reveal', playerId: p.id, hand: [...p.hand] });
    });
  }

  handleScoreRound(effect, ctx) {
    const meta = this.rules.metadata || {};
    const cardValues = meta.cardValues || {};
    ctx.state.players.forEach((p) => {
      const score = this.handScore(p.hand, cardValues);
      p.score = (p.score || 0) + score;
      ctx.events?.push({ type: 'round_score', playerId: p.id, score });
    });

    const winScore = meta.kabuWinScore;
    if (winScore != null) {
      const winner = ctx.state.players.find((p) => p.score <= winScore);
      if (winner) {
        ctx.state.match.hasWinner = true;
        ctx.state.match.winnerId = winner.id;
        ctx.state.turn.phaseId = 'game_over';
      }
    }
  }

  handleIf(effect, ctx) {
    const cond = this.evaluateCondition({
      expr: effect.condition,
      state: ctx.state,
      playerId: ctx.playerId,
      params: ctx.params,
      abilityContext: ctx.abilityContext,
    });
    const branch = cond ? effect.then : effect.else;
    (branch || []).forEach((inner) => this.applyEffect(inner, ctx));
  }

  handleRunAbilityForCard(effect, ctx) {
    const handIndex = ctx.params?.[effect.handIndexParam];
    const player = this.resolvePlayer(ctx.state, ctx.playerId, 'currentPlayer');
    const card = player.hand[handIndex];
    const abilityId = this.rules.metadata?.cardAbilities?.[card];
    if (!abilityId) return;
    const abilityParams = { handIndex, cardCode: card };
    this.executeAbility({ state: ctx.state, playerId: ctx.playerId, abilityId, params: abilityParams });
  }

  handleSwapCards(effect, ctx) {
    const fromPlayer = this.resolvePlayer(ctx.state, ctx.playerId, effect.fromPlayer || 'currentPlayer');
    const toPlayer = this.resolvePlayer(ctx.state, ctx.playerId, effect.toPlayer || 'nextPlayer');
    const fromIdx = ctx.params?.[effect.fromIndexParam];
    const toIdx = ctx.params?.[effect.toIndexParam];
    const reveal = effect.reveal || false;

    if (fromIdx == null || toIdx == null) throw new Error('Índices requeridos para swapCards');
    const fromCard = fromPlayer.hand[fromIdx];
    const toCard = toPlayer.hand[toIdx];
    fromPlayer.hand[fromIdx] = toCard;
    toPlayer.hand[toIdx] = fromCard;

    fromPlayer.known ||= new Array(fromPlayer.hand.length).fill(false);
    toPlayer.known ||= new Array(toPlayer.hand.length).fill(false);
    fromPlayer.known[fromIdx] = reveal;
    toPlayer.known[toIdx] = reveal;

    if (reveal) {
      ctx.events?.push({ type: 'card_reveal', playerId: fromPlayer.id, cardIndex: fromIdx, card: toCard });
      ctx.events?.push({ type: 'card_reveal', playerId: toPlayer.id, cardIndex: toIdx, card: fromCard });
    }
  }

  handleSwapCardsWithPeek(effect, ctx) {
    const myPlayer = this.resolvePlayer(ctx.state, ctx.playerId, effect.fromPlayer || 'currentPlayer');
    const oppPlayer = this.resolvePlayer(ctx.state, ctx.playerId, effect.toPlayer || 'nextPlayer');
    const myIdx = ctx.params?.[effect.myIndexParam];
    const oppIdx = ctx.params?.[effect.opponentIndexParam];

    if (myIdx == null || oppIdx == null) throw new Error('Índices requeridos para swapCardsWithPeek');

    const myCard = myPlayer.hand[myIdx];
    const oppCard = oppPlayer.hand[oppIdx];

    ctx.events?.push({ type: 'card_reveal', playerId: myPlayer.id, cardIndex: myIdx, card: myCard });
    ctx.events?.push({ type: 'card_reveal', playerId: oppPlayer.id, cardIndex: oppIdx, card: oppCard });

    myPlayer.hand[myIdx] = oppCard;
    oppPlayer.hand[oppIdx] = myCard;

    myPlayer.known ||= new Array(myPlayer.hand.length).fill(false);
    oppPlayer.known ||= new Array(oppPlayer.hand.length).fill(false);
    myPlayer.known[myIdx] = true;
    oppPlayer.known[oppIdx] = true;
  }

  handleRevealCard(effect, ctx) {
    const target = this.resolvePlayer(ctx.state, ctx.playerId, effect.target || 'currentPlayer');
    const idx = ctx.params?.[effect.handIndexParam];
    if (idx == null || idx < 0 || idx >= target.hand.length) throw new Error('Índice inválido en revealCard');
    const card = target.hand[idx];
    target.known ||= new Array(target.hand.length).fill(false);
    target.known[idx] = true;
    ctx.events?.push({ type: 'card_reveal', playerId: target.id, cardIndex: idx, card });
  }

  extractFrom(state, ref, playerId, paramName, params, forcedIndex) {
    const { pile, index } = this.resolvePile(state, playerId, ref, paramName, params, forcedIndex);
    if (!pile.length) return null;
    const idx = index != null ? index : pile.length - 1;
    return pile.splice(idx, 1)[0];
  }

  pushTo(state, ref, playerId, card) {
    const { pile } = this.resolvePile(state, playerId, ref);
    pile.push(card);
  }

  resolvePile(state, playerId, ref, paramName, params, forcedIndex) {
    if (ref === 'deck') return { pile: state.deck, index: forcedIndex ?? null };
    if (ref === 'discard') return { pile: state.discard, index: forcedIndex ?? null };
    const player = this.resolvePlayer(state, playerId, ref.includes('nextPlayer') ? 'nextPlayer' : 'currentPlayer');
    if (ref.endsWith('hand')) return { pile: player.hand, index: forcedIndex ?? params?.[paramName] ?? null };
    throw new Error(`Referencia no soportada: ${ref}`);
  }

  resolvePlayer(state, playerId, ref) {
    if (ref === 'currentPlayer') return state.players[state.turn.currentPlayerIndex];
    if (ref === 'nextPlayer') {
      const idx = (state.turn.currentPlayerIndex + 1) % state.players.length;
      return state.players[idx];
    }
    return state.players.find((p) => p.id === playerId) || state.players[0];
  }

  resolveTarget(state, playerId, ref) {
    if (ref === 'turn') return state.turn;
    if (ref === 'round') return state.round;
    if (ref === 'match') return state.match;
    if (ref === 'turn.currentPlayer') return this.resolvePlayer(state, playerId, 'currentPlayer');
    if (ref === 'currentPlayer') return this.resolvePlayer(state, playerId, 'currentPlayer');
    if (ref === 'nextPlayer') return this.resolvePlayer(state, playerId, 'nextPlayer');
    throw new Error(`Target no soportado: ${ref}`);
  }

  buildConditionScope({ state, playerId, params, abilityContext }) {
    const currentPlayer = this.resolvePlayer(state, playerId, 'currentPlayer');
    const nextPlayer = this.resolvePlayer(state, playerId, 'nextPlayer');
    const metadata = this.rules.metadata || {};
    const deck = { size: state.deck.length };
    const discard = { size: state.discard.length };
    const turn = state.turn;
    const handScore = (hand) => this.handScore(hand, metadata.cardValues || {});

    return {
      state,
      metadata,
      currentPlayer,
      nextPlayer,
      deck,
      discard,
      turn,
      params,
      abilityContext,
      handScore,
    };
  }

  evaluateCondition({ expr, state, playerId, params = {}, abilityContext = {} }) {
    if (!expr) return true;
    const scope = this.buildConditionScope({ state, playerId, params, abilityContext });
    const keys = Object.keys(scope);
    const values = Object.values(scope);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `return (${expr});`);
    return Boolean(fn(...values));
  }

  handScore(hand, values) {
    return hand.reduce((acc, card) => {
      const rank = card.slice(0, -1);
      return acc + (values?.[rank] ?? 0);
    }, 0);
  }
}

function createSeededRng(seed) {
  let s = typeof seed === 'string' ? hashString(seed) : Number(seed) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}
