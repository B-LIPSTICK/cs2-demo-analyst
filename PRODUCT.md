# Product

<!-- impeccable:product-schema 1 -->

## What this is
CS2 Demo Analyst is a Windows desktop workstation for reviewing Counter-Strike 2 demos. It turns local `.dem` recordings into a searchable match archive, a round-by-round analysis desk, synchronized voice transcripts, and AI-assisted post-match review.

## Primary users
- Players and coaches reviewing their own matches.
- Analysts who need to find a round, kill, or voice call and jump back into the demo immediately.
- Chinese CS2 players using Perfect World / 5E / Steam demo folders.

## Core jobs
1. Find a demo quickly across local folders and platforms.
2. Understand the match shape: score, rounds, economy, kills, players, and timeline.
3. Read or search team voice comms and jump to the exact moment.
4. Ask an AI analyst about the match with the parsed demo as context.
5. Launch the demo in CS2 and use the in-game voice HUD safely.

## Product truths to preserve
- Local-first: demos, transcripts, and analysis stay on the user's machine.
- Every timestamp, round, and kill is actionable and should jump into the demo with the existing lead-in behavior.
- The app supports dark and light themes, Chinese and English, keyboard focus, and 1080px-wide windows.
- Steam safety is non-negotiable: the UI must never imply that modifying Valve files is normal or safe. HUD injection is an explicit experimental path with cleanup.
- Existing IPC, parser, transcript, AI, and HUD behavior must not be broken by visual work.

## Platform
Windows 10+ desktop (Electron + React). The interface is a dense desktop tool, not a marketing site.

## Stack
Electron 43, React 19, TypeScript, Vite, plain CSS. No new runtime dependency is required for this redesign.
