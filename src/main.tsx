import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import "./app/theme/tokens.css"
import "./app/theme/base.css"
import "./app/app.css"
import { App } from "./app/App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
