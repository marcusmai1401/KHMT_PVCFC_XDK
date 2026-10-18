import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { NavigationGuardProvider } from "./shared/editing/NavigationGuardProvider";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NavigationGuardProvider>
      <App />
    </NavigationGuardProvider>
  </React.StrictMode>
);
