import { useState } from 'react'
import { TopBar } from './ui/TopBar'
import { TransportBar } from './ui/TransportBar'
import { Timeline } from './ui/Timeline'
import { Inspector, type InspectorTab } from './ui/Inspector'
import { useShortcuts } from './ui/shortcuts'

export function App() {
  const [tab, setTab] = useState<InspectorTab>('selection')
  useShortcuts()

  return (
    <div className="st-app">
      <TopBar onOpenServos={() => setTab('servos')} />
      <TransportBar />
      <main className="st-main">
        <Timeline />
        <Inspector tab={tab} onTab={setTab} />
      </main>
    </div>
  )
}
