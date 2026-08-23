# Ravi's Day Off

A fast-paced, one-shot-kill first-person shooter set in a two-storey call center. Built with **Three.js + cannon-es + Vite/TypeScript** — no game engine, no asset files (all geometry, textures and audio are procedural).

## Run

```bash
npm install
npm run dev        # http://localhost:8180
npm run build      # type-check + production bundle in dist/
```

## Controls

| Action | Key |
|---|---|
| Move | W A S D |
| Look | Mouse (pointer lock) |
| Fire | Left click |
| Sprint | Shift |
| Crouch | Ctrl / C |
| Jump | Space |

One shot kills — you and them. Use cubicles as cover (bullets pierce one panel), shatter glass partitions, drop through the broken mezzanine railing, and listen: intruders investigate gunshots and sprinting footsteps.

## Architecture

```
src/
├── core/         GameEngine (loop), EventBus, InputManager, AudioManager (procedural Web Audio)
├── entities/     FPSPlayer, WeaponViewmodel, Enemy (ragdoll), EnemyAI (patrol/suspicious/attack)
├── environment/  OfficeLevelBuilder (2-floor layout + colliders + waypoints), BreakableGlass, FlickeringLight
├── fx/           ParticleManager, BloodDecalSystem, CRTShader
├── scenes/       MainMenuScene (security-office diorama), OfficeLevelScene (ballistics, physics, win/lose)
└── ui/           MenuUI (terminal), FPSHUD (crosshair, hit markers, kill feed)
```

## Working on it with Claude Code

Clone the repo, run `npm install`, then open the folder in Claude Code. `npm run dev` serves the game on port 8180; `npm run build` must stay green (`tsc --noEmit` is part of it).
