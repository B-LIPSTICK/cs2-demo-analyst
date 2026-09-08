# CS2 Demo Analyst

![CS2 Demo Analyst](assets/logo/csicon-512.png)

English | [简体中文](README.md)

Turn a CS2 demo into replayable, searchable match evidence.

CS2 Demo Analyst is a Windows desktop replay-analysis tool. Drop in a `.dem` file to parse the score, rounds, kills and player stats. When the recording carries in-game voice, the app can transcribe it by player and timestamp, then link the results back to CS2's built-in demo player.

## What you can do

- **Understand the entire match**: inspect the map, score, round timeline, kill feed, advanced player metrics (Rating / ADR / KAST% / Opening Duels) and round economy buys.
- **Find the important moments**: click a round, kill or transcript line to seek CS2 to that timestamp.
- **Search team voice**: transcribe player voice from the demo and browse it by player, round and time.
- **See who is speaking in-game**: optionally enable the voice HUD to show the current speaker and team color during playback.
- **Ask an AI about the match**: use any OpenAI-compatible model to investigate highlights, turning points and player performance.

## Workflow

```text
Add a folder containing demos
             ↓
Parse score, rounds, kills and player data
             ↓
Optional: extract and transcribe in-game voice
             ↓
Search, inspect and replay the key moments in CS2
```

## Screenshots

| Library | Demo detail | Transcript |
| --- | --- | --- |
| ![Library](docs/screenshots/1.0-library.png) | ![Demo detail](docs/screenshots/1.0-detail.png) | ![Transcript](docs/screenshots/1.0-transcript.png) |

## Install

Download a release from [Releases](https://github.com/B-LIPSTICK/cs2-demo-analyst/releases):

- `CS2-Demo-Analyst-1.0.0-setup.exe`: installer with a selectable install directory plus desktop and Start Menu shortcuts.
- `CS2-Demo-Analyst-1.0.0-win64-portable.zip`: portable build; extract and run.

CS2 must already be installed. On first launch, add a folder containing your `.dem` files in Settings.

## Usage

1. Open the app and add a folder containing `.dem` files to the library.
2. Wait for parsing to finish, then open a demo to inspect rounds, kills and player data.
3. Click **Play in CS2** to use CS2's built-in demo player.
4. For text-based review, choose local Whisper or a cloud API on the Transcript page and start transcription.
5. To show speakers inside the game, enable the voice HUD in Settings and play the demo from its detail page.

## Voice and privacy

Transcription only works when the demo actually contains player voice. FACEIT, Wanmei and other third-party recordings may include voice; Valve matchmaking demos usually do not.

- **Local Whisper**: audio stays on your machine, but csgove, Whisper and a model file must be downloaded.
- **Cloud API**: audio is uploaded to the provider you configure, such as Groq. Review that provider's privacy policy before use.
- **Voice HUD**: the app temporarily injects a CS2 Panorama search path to load the HUD, then restores the related files when playback ends or the app exits.

## AI review

The AI page sends structured match data to any OpenAI-compatible API. Example questions include:

- Which rounds changed the direction of the match?
- Which kills or clutches are worth reviewing?
- How did a player perform on the T and CT sides?

API keys and service URLs are stored in the local app settings. With a cloud model, the data sent depends on the provider and endpoint you configure.

## Development

Read [AGENTS.md](AGENTS.md) before working on the project. It documents the current architecture, verification workflow and known issues.

```bash
npm install
npm run dev          # development mode
npm run typecheck    # TypeScript checks
npm run build        # build Electron resources
npm run dist:zip     # package the Windows portable ZIP
```

Stack: Electron, React 19 and TypeScript. Demo parsing uses [deadem](https://github.com/Igor-Losev/deadem), voice extraction uses csgove, and transcription supports whisper.cpp and Groq.

## Current limitations

- Windows only.
- Demo parsing follows the CS2 demo format and may need updates after CS2 changes.
- Standard Valve matchmaking demos usually do not contain player voice, so they cannot be transcribed.
- The in-game voice HUD requires Steam and CS2 to be installed and may trigger Steam's game-file verification.

## License

MIT. Windows only.
