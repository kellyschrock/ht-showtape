# Showtape

A show editor for Hitec CAN servos. Build a timeline of servo moves, as in
an audio or video editor, then play it back to the servos in sync.

Built as a desktop app with Electron. It drives the servos through a DPC-20
or DPC-CAN adapter, using the protocol, transport and design system from
[ht-servo](https://github.com/kellyschrock/ht-servo), checked out as a
submodule in `ht-servo/`.

## State

| Piece | State |
|---|---|
| Timeline editor: channels, keyframes, smooth/linear/hold curves, undo, snapping | Done |
| Time source: a plain clock, with an optional tempo grid | Done |
| Servo output: per-channel protocol, limits, speed limiting, live scrubbing | Done against the simulator |
| Show files (`.showtape`) | Done |
| Audio source | Planned |
| MIDI source (`.mid` files) | Planned |
| SMPTE source (LTC and MIDI timecode) | Planned |

## Getting started

Requires Node 22 or newer. Clone with the submodule, or fetch it after:

```bash
git clone --recurse-submodules https://github.com/kellyschrock/ht-showtape.git
git submodule update --init        # in a clone made without it
```

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
- The mouse wheel scrolls along the timeline over the lanes, and through
  the channels over their names. **Shift** swaps the two, and **Ctrl**
  zooms about the pointer.
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

## Playing a finished show

`showtape-play` plays a show with no screen, for the figure once it is built:
a Raspberry Pi with the DPC-20 on USB, say, started at boot. It sends through
the same output as Servos live, so the figure moves as it did in the editor.

```bash
npm run build:player                     # writes dist-player/showtape-play.cjs
node dist-player/showtape-play.cjs show.showtape --loop --gap 10
node dist-player/showtape-play.cjs show.showtape --simulator   # no hardware
```

Before playing it eases every servo slowly (`--home-speed`, 30 deg/s by
default) from wherever it is to the show's first pose. When the show ends,
or on Ctrl+C or `systemctl stop`, it eases them back to rest before letting
go; a second Ctrl+C quits at once. Solo is ignored and mute is kept. If the
adapter goes away it exits with an error, for systemd to restart it.

On the Pi, Node 20 or later, the bundle and serialport are all it needs; the
rest of this repo and ht-servo are only for building it:

```bash
mkdir -p /opt/showtape && cd /opt/showtape
cp /path/to/showtape-play.cjs /path/to/show.showtape .
npm install serialport@13
```

`player/showtape-play.service` is a systemd unit to start it at boot.

## Installing on Linux

```bash
npm run dist:linux                 # writes dist/showtape_<version>_amd64.deb
sudo apt install ./dist/showtape_0.1.0_amd64.deb
```

It installs to `/opt/Showtape` with a `showtape` command and a menu entry,
and opens `.showtape` files double-clicked in the file manager. With the app
already open, they open in its window, which asks about unsaved changes
first. zenity comes with it as a recommended package.

To reach the adapter, the user must be in the `dialout` group:
`sudo usermod -aG dialout $USER`, then log out and back in.

## Updating ht-servo

Showtape builds against the ht-servo commit the submodule is pinned to, not
whatever is checked out elsewhere. To take in newer ht-servo work:

```bash
git -C ht-servo fetch && git -C ht-servo checkout <commit or branch>
npm test && npm run typecheck
git add ht-servo && git commit -m "Update ht-servo"
```

To try uncommitted ht-servo changes, make them in `ht-servo/` itself, or
point its remote at a local checkout.

## How it fits together

```
electron/        main process and preload. The serial host and the htservo
                 bridge are ht-servo's own, imported from ht-servo/
build/           the app icon (icon.svg), and the PNGs made from it
ht-servo/        the ht-servo submodule
player/          showtape-play's command line and its serial link
src/
  show/          the show document, curve sampling, limits, timecode. Pure
  clock/         timeline clocks. The time source today, audio/MIDI/SMPTE next
  playback/      ServoOutput: samples the show and writes positions to the bus
  player/        Player: homes, plays, loops and rests, for showtape-play
  stores/        the open show (with undo) and the transport
  ui/            app bar, transport, timeline, inspector
```

`@ht/*` resolves to `ht-servo/src/*`, in both Vite and TypeScript.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build:web && npm run build:electron && npm run build:player
```
