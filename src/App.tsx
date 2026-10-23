import { useState } from 'react'
import { TopBar } from './ui/TopBar'
import { TransportBar } from './ui/TransportBar'
import { Timeline } from './ui/Timeline'
import { Inspector, type InspectorTab } from './ui/Inspector'
import { useShortcuts } from './ui/shortcuts'
import { useUnsavedGuard } from './ui/fileActions'
import { MonitorPopout } from './ui/MonitorPanel'

export function App() {
  const [tab, setTab] = useState<InspectorTab>('selection')
  useShortcuts()
  useUnsavedGuard()

  return (
    <div className="st-app">
      <TopBar onOpenServos={() => setTab('servos')} />
      <TransportBar />
      <main className="st-main">
        <Timeline />
        <Inspector tab={tab} onTab={setTab} />
      </main>
      <MonitorPopout />
    </div>
  )
}
