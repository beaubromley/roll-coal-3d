# Roll Coal, Make Hole 2: Company Man

A 3D satire of life as the Company Man on a land drilling rig. Walk a modeled walking-rig location (box-on-box substructure, 25.5 ft drill floor, cantilever mast, side-by-side mud system, camp and gate), keep a live drilling sim on track, and survive increasingly ridiculous jobs — culminating in the Armageddon well from the original [Roll Coal Make Hole](https://github.com/beaubromley/roll-coal-make-hole).

Babylon.js + TypeScript + Vite. No asset files besides crew portraits; the whole rig is procedural.

## Run
```
npm install
npm run dev     # http://localhost:5173
npm run build   # type-check + production build into dist/
```

## Controls
WASD move · Shift sprint · Mouse look · Space jump · E interact · V first/third person · M mute · Esc close panel

## Layout
- `src/rig.ts` the location (rig, pad, camp, props, NPCs, far field)
- `src/sim.ts` drilling + well-control physics (ported from the original game)
- `src/game.ts` jobs/missions, panels (driller console, hopper, choke panel kill sheet, etc.), HUD logic, finale
- `src/player.ts` first/third person controller with AABB collision
