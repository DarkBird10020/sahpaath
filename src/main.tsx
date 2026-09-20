import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/manrope";
import "@fontsource-variable/dm-sans";
import "./styles.css";
import "./account.css";
import { secureRedirectTarget } from "./lib/secureOrigin";

class Boundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>The classroom could not open</h1>
        <p>Your saved lessons are on the local server. Reload to try again.</p>
        <button onClick={() => location.reload()}>Reload classroom</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const secureTarget = secureRedirectTarget(location);
if (secureTarget) location.replace(secureTarget);
else ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>,
);
