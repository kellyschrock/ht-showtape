import { useEffect } from 'react'
import { BRAND } from '@ht/brand'
import { useConnection } from '@ht/stores/connection'
import { SOURCES } from '../show/model'
import { useShow } from '../stores/show'

const LINK_WORDS = {
  closed: ['Not connected', ''],
  opening: ['Connecting', 'warn'],
  ready: ['Adapter ready', 'ok'],
  open: ['No adapter', 'bad'],
  error: ['Port error', 'bad'],
} as const

export function TopBar({ onOpenServos }: { onOpenServos(): void }) {
  const name = useShow((s) => s.show.name)
  const source = useShow((s) => s.show.source.kind)
  const dirty = useShow((s) => s.dirty)
  const path = useShow((s) => s.path)
  const edit = useShow((s) => s.edit)
  const linkState = useConnection((s) => s.state)
  const refreshPorts = useConnection((s) => s.refreshPorts)

  useEffect(() => {
    void refreshPorts()
  }, [refreshPorts])

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name} — Showtape`
  }, [name, dirty])

  const [word, tone] = LINK_WORDS[linkState]

  return (
    <header className="ht-appbar st-appbar">
      <div className="ht-appbar__band">
        <img className="ht-appbar__logo" src={BRAND.iconPath} alt="" />
        <span className="ht-appbar__title">Showtape</span>
        <input
          className="st-showname"
          value={name}
          aria-label="Show name"
          title={path ?? 'Not saved yet'}
          onChange={(e) => edit((s) => ({ ...s, name: e.target.value }), 'name')}
        />
        {dirty ? <span className="st-dirty" title="Unsaved changes" /> : null}
      </div>

      <div className="ht-appbar__band ht-appbar__band--center">
        <div className="st-segmented" role="radiogroup" aria-label="Input source">
          <span className="st-segmented__label">Source</span>
          {SOURCES.map((s) => (
            <button
              key={s.kind}
              type="button"
              role="radio"
              aria-checked={source === s.kind}
              className={`st-segmented__item${source === s.kind ? ' st-segmented__item--on' : ''}`}
              disabled={!s.ready}
              title={s.ready ? s.hint : `${s.hint} Planned.`}
              onClick={() => edit((show) => ({ ...show, source: { ...show.source, kind: s.kind } }))}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ht-appbar__band ht-appbar__band--right">
        <button type="button" className="ht-btn ht-btn--ghost" onClick={() => useShow.getState().newShow()}>
          New
        </button>
        <button type="button" className="ht-btn ht-btn--ghost" title="Ctrl+O" onClick={() => void useShow.getState().open()}>
          Open
        </button>
        <button type="button" className="ht-btn ht-btn--ghost" title="Ctrl+S, Ctrl+Shift+S to save as" onClick={() => void useShow.getState().save()}>
          Save
        </button>
        <button
          type="button"
          className={`ht-status st-linkstatus${tone ? ` ht-status--${tone}` : ''}`}
          onClick={onOpenServos}
          title="Adapter and servos"
        >
          <span className="ht-status__dot" />
          <span className="ht-status__word">{word}</span>
        </button>
      </div>
    </header>
  )
}
