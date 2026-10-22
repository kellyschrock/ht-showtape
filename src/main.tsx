import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// The design system is ht-servo's, so both apps look like one family. The
// app sheet comes second so its rules win without !important.
import '@ht/styles/hitec.css'
import './styles/app.css'

const host = document.getElementById('root')
if (!host) throw new Error('The page is missing its #root element.')

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>
)
