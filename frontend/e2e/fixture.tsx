import React from "react";
import {createRoot} from "react-dom/client";
import {ETModule} from "../src/features/et/ETModule";
import {FIWorkspace} from "../src/features/fi/FIWorkspace";
import {WebInputForm} from "../src/features/web-input/WebInputForm";
import {NavigationGuardProvider} from "../src/shared/editing/NavigationGuardProvider";
import "../src/styles.css";
const mode = new URLSearchParams(location.search).get("mode");
const tabsHost = document.createElement("div");
document.body.prepend(tabsHost);
createRoot(document.getElementById("root")!).render(<NavigationGuardProvider>
{mode === "et" ? <ETModule role="Admin" currentUserId="synthetic" editMode /> : mode === "fi" ? <FIWorkspace role="Staff" currentUserId="synthetic" currentTeam="TBCH" displayName="Synthetic User" tabsHost={tabsHost} /> : <WebInputForm role="Admin" currentUserId="synthetic" currentTeam="TBCH" editMode />}
</NavigationGuardProvider>);
