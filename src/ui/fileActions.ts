import { useEffect } from 'react'
import { useShow } from '../stores/show'
import { useTransport } from '../stores/transport'

/**
 * New and Open, as the app bar and the keys run them: unsaved changes are
 * asked about first, and the transport is reset for the incoming show.
 *
 * Servos live is switched off rather than carried across. The next show
 * may put other servos on other channels, and it should not move the
 * figure until someone turns output on for it.
 */

function resetTransport(): void {
  const transport = useTransport.getState()
  transport.disarm()
  transport.stop()
}

export async function newFile(): Promise<void> {
  const show = useShow.getState()
  if (!(await show.confirmDiscard())) return
  resetTransport()
  show.newShow()
}

export async function openFile(): Promise<void> {
  const show = useShow.getState()
  if (!(await show.confirmDiscard())) return
  if (await show.open()) resetTransport()
}

/** Keeps the window from closing over unsaved changes, in Electron and the browser. */
export function useUnsavedGuard(): void {
  useEffect(() => {
    const bridge = window.showtape
    // Only on a change: a drag edits the show many times a second.
    let last = ''
    const report = () => {
      const { dirty, show } = useShow.getState()
      const key = `${dirty}:${show.name}`
      if (key === last) return
      last = key
      bridge?.window.setDirty(dirty, show.name)
    }
    report()
    const unsubscribe = useShow.subscribe(report)

    const offSaveAndClose = bridge?.window.onSaveAndClose(() => {
      void useShow
        .getState()
        .save()
        .then(() => {
          if (!useShow.getState().dirty) bridge.window.close()
        })
    })

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!bridge && useShow.getState().dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      unsubscribe()
      offSaveAndClose?.()
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])
}
