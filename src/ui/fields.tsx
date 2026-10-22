import { useEffect, useState, type ReactNode } from 'react'

/**
 * A number input that edits as you type but never commits a half-typed
 * value: "-" or "" stay in the box until they parse, and leaving the field
 * puts back whatever the show actually holds.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  suffix,
}: {
  value: number
  onChange(v: number): void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  suffix?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(String(round(value)))
  }, [value, focused])

  return (
    <span className="st-num">
      <input
        className="ht-input ht-input--num"
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setDraft(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value.trim() === '' || !Number.isFinite(v)) return
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)))
        }}
      />
      {suffix ? <span className="st-num__suffix">{suffix}</span> : null}
    </span>
  )
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="ht-field st-field" title={hint}>
      <span className="ht-label">{label}</span>
      <span className="st-field__control">{children}</span>
    </label>
  )
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="st-section">
      <header className="st-section__head">
        <h3>{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  )
}
