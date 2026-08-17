import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { AuthGate } from "./components/AuthGate";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        {/* Inside the gate, so a render crash reads as a crash to a signed-in user rather than
            looking like a failed login. */}
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AuthGate>
    </AuthProvider>
  </StrictMode>
);
