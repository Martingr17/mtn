import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/App";
import { AppProviders } from "@/app/providers";
import { applyTheme, getStoredTheme } from "@/utils/theme";
import "@/styles/tokens.css";
import "@/styles/app.css";

applyTheme(getStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
