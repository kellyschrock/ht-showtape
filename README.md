# Showtape

A show editor for Hitec CAN servos. Build a timeline of servo moves, as in
an audio or video editor, then play it back to the servos in sync.

Built as a desktop app with Electron. It drives the servos through a DPC-20
or DPC-CAN adapter, using the protocol, transport and design system from the
sibling [ht-servo](../ht-servo) checkout.

## State

| Piece | State |
|---|---|
| Timeline editor: channels, keyframes, smooth/linear/hold curves, undo, snapping | Done |
| Time source: a plain clock, with an optional tempo grid | Done |
| Servo output: per-channel protocol, limits, speed limiting, live scrubbing | Done against the simulator |
| Show files (`.showtape.json`) | Done |
| Audio source | Planned |
| MIDI source (`.mid` files) | Planned |
| SMPTE source (LTC and MIDI timecode) | Planned |

## Getting started

Requires Node 22 or newer, and `../ht-servo` checked out beside this repo.
On Linux, the open and save dialogs use `zenity` (standard on Ubuntu)
when it is installed, because Electron's own dialog treats Enter and
double-click as Cancel.

```bash
npm install
npm run dev:electron -- --simulator   # desktop app, with the simulated adapter
npm run dev                           # browser only, at the printed URL
```

`--simulator` offers ht-servo's simulated adapter, with three servos on it
(two on CAN 2.0A, one on DroneCAN), while no real port is present.

## Using it

- **Source** in the app bar picks what the timeline is synchronised to.
- **Servos** tab: connect the adapter, scan, then **Add channel** for each
  servo you want in the show.
- Double-click a lane to add a key, or press **K** to add one at the
  playhead. Drag keys to move them. Shift-click selects several. The arrow
  keys nudge the selected keys, with Shift for bigger steps.
- **Space** plays and pauses. **Home** and **End** jump to either end.
  **Ctrl+Z** undoes, and **Ctrl+S** saves. **Ctrl+N** starts a new show and
  **Ctrl+O** opens one; both ask first if there are unsaved changes, and
  turn **Servos live** off.
- A red band marks a move faster than the channel's **Max speed**, and a
  dashed line shows where the servo really goes there, since output never
  exceeds that speed. Select a key to see the speed into and out of it.
- The **Monitor** tab shows a simulated servo per channel, its horn
  turning as the show plays or scrubs. It runs the same limits, speed
  limit, mute and solo as live output, so no adapter is needed to watch.
  **Pop out** moves it to its own window, for another screen; closing that
  window docks it again.
- **Duplicate channel** in the Inspector, or **Ctrl+D**, copies the
  selected channel with its keys and limits. The copy goes on the next
  free servo and node IDs, so retarget it before playing.
- **Servos live** sends the show to the servos. It keeps sending while
  paused, so scrubbing or dragging a key moves the real figure.

## Protocols

Each channel's protocol is either **Show default**, set on the Show tab, or
its own choice of CAN 2.0A, CAN 2.0B or DroneCAN. One show can mix them.
The bitrate is per show, because one adapter runs one bitrate.

## Safety

Every value sent is clamped to the channel's minimum and maximum, then
limited to its maximum speed. When the servos go live, each servo's present
position is read first, so the first move eases from where the servo actually
is. A show file with a missing or malformed limit loads with the safe default
rather than none.

## How it fits together

```
electron/        main process and preload. The serial host and the htservo
                 bridge are ht-servo's own, imported from ../ht-servo
src/
  show/          the show document, curve sampling, limits, timecode. Pure
  clock/         timeline clocks. The time source today, audio/MIDI/SMPTE next
  playback/      ServoOutput: samples the show and writes positions to the bus
  stores/        the open show (with undo) and the transport
  ui/            app bar, transport, timeline, inspector
```

`@ht/*` resolves to `../ht-servo/src/*`, in both Vite and TypeScript.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build:web && npm run build:electron
```
