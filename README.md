# Runtime Web para juegos data‑driven

Este runtime JavaScript ejecuta los JSON de reglas descritos en `GAME_SCHEMA.md` directamente en el navegador, pensado para acompañar al editor visual y publicar juegos 100% estáticos (p. ej. en GitHub Pages).

## Objetivos

- **Alineado con el motor Python**: reproduce las mismas operaciones (`moveCard`, `setFlag`, `swapCards`, etc.) en un entorno web.
- **Data-driven extremo**: ninguna regla está hardcodeada; todo viene del JSON generado por el editor.
- **Embebible**: se puede consumir desde aplicaciones Vite/React o cualquier bundle web.

## API rápida

```js
import { WebRuntime } from './runtime.js';

const runtime = new WebRuntime({
  rules,
  seed: 'demo', // crea RNG determinista sin depender de Math.random
  rng: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32, // opcional, sobrescribe seed/Math.random
  logger: console.log, // opcional
});

const state = runtime.initState({
  players: [
    { id: 1, name: 'Ana' },
    { id: 2, name: 'Luis' },
  ],
  shuffle: false, // respeta orden de deck en pruebas o demos
});
const available = runtime.getAvailableActions({ state, playerId: 1 });
const result = runtime.executeAction({ state, playerId: 1, actionId: 'draw_from_deck' });
```

## Integración con el editor

- El editor genera `actions`, `abilities`, `metadata` y `rules` bajo el mismo esquema que el motor Python.
- El runtime consume directamente ese JSON: no requiere transformaciones adicionales.
- Los flujos declarativos de `interaction_design` pueden llamar a `getAvailableActions`/`executeAction` para validar condiciones y disparar efectos.

### Demo estática lista para GitHub Pages

- Abre `web-runtime/example.html` directamente desde cualquier servidor estático (p. ej. `python -m http.server` o publicándolo en Pages) para probar el runtime sin backend.
- El ejemplo importa `runtime.js` vía `<script type="module">`, inicializa un mazo de prueba y muestra botones para ejecutar acciones/abilities del JSON.
- Ajusta las reglas dentro del propio HTML o reemplázalas con las exportadas por tu editor visual (incluyendo `actions`, `abilities` y `metadata`).

## Limitaciones actuales

- El cálculo de puntaje y la detección de ganador siguen las heurísticas básicas incluidas aquí; si tus reglas personalizadas necesitan lógica distinta, agrega nuevos efectos o condiciones.
- Las expresiones de condiciones se evalúan con un contexto controlado pero usando `Function`. No aceptes reglas no confiables.
- Se generan eventos (revelaciones, logs) en memoria; conéctalos a tu UI para reflejar cambios.

## Extensión

- Para añadir un nuevo `op`, crea un handler en `runtime.js` dentro de `this.effectHandlers`.
- Para validar expresiones extra, amplía `buildConditionScope` con más helpers.
- El runtime está escrito en JavaScript llano para facilitar su bundling en proyectos existentes.
