import { audibleChannels, type Show } from '../show/model'
import { sampleChannel, servoDegrees } from '../show/sample'
import { plan } from './output'

/**
 * A stand-in for the servos, for watching a show without hardware.
 *
 * It runs the same plan() as live output, so a simulated servo goes
 * exactly where a real one would be told to: limits, invert, trim, the
 * speed limit, mute and solo included. It steps once a screen frame
 * rather than at the output rate, which only changes how finely the speed
 * limit is sliced, not where it lands.
 */

/** Degrees off the curve below which a servo counts as keeping up. */
const LAG_DEG = 0.5

export interface SimServo {
  channelId: string
  /** Where the servo is, in degrees at the servo (after invert and trim). */
  degrees: number
  /** Where the curve wants it, at the servo. */
  wanted: number
  /** Held back by the speed limit. */
  lagging: boolean
  /** Muted, or not soloed while others are: it holds where it was. */
  holding: boolean
}

export class ServoMonitor {
  private last = new Map<string, number>()

  /** Moves every simulated servo on by `dtMs`, toward the show at `t`. */
  step(show: Show, t: number, dtMs: number): SimServo[] {
    const moving = new Map(plan(show, t, this.last, dtMs).map((w) => [w.channelId, w.degrees]))
    const audible = new Set(audibleChannels(show).map((c) => c.id))
    const states = show.channels.map((channel) => {
      const wanted = servoDegrees(channel, sampleChannel(channel, t))
      // A channel seen for the first time starts on its curve, held ones included.
      const degrees = moving.get(channel.id) ?? this.last.get(channel.id) ?? wanted
      return {
        channelId: channel.id,
        degrees,
        wanted,
        lagging: audible.has(channel.id) && Math.abs(degrees - wanted) > LAG_DEG,
        holding: !audible.has(channel.id),
      }
    })
    this.last = new Map(states.map((s) => [s.channelId, s.degrees]))
    return states
  }
}
