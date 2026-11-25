import { TDSMobileAITProvider } from "@toss/tds-mobile-ait";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import { COLORS } from "./styles/tokens";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TDSMobileAITProvider brandPrimaryColor={COLORS.primary}>
      <App />
    </TDSMobileAITProvider>
  </StrictMode>,
);
