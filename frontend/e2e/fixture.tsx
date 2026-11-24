import React from "react";
import {createRoot} from "react-dom/client";
import {ETModule} from "../src/features/et/ETModule";
import {FIWorkspace} from "../src/features/fi/FIWorkspace";
import {WebInputForm} from "../src/features/web-input/WebInputForm";
import {NavigationGuardProvider} from "../src/shared/editing/NavigationGuardProvider";
import "../src/styles.css";
const params = new URLSearchParams(location.search);
const mode = params.get("mode");
const fiRole = params.get("role") || "Staff";
const fiUser = params.get("user") || "synthetic";
const fiTeam = params.get("team") || "TBCH";
const fiName = params.get("name") || "Synthetic User";
const tabsHost = document.createElement("div");
document.body.prepend(tabsHost);
createRoot(document.getElementById("root")!).render(<NavigationGuardProvider>
{mode === "et" ? <ETModule role="Admin" currentUserId="synthetic" editMode /> : mode === "fi" ? <FIWorkspace role={fiRole} currentUserId={fiUser} currentTeam={fiTeam} displayName={fiName} tabsHost={tabsHost} /> : <WebInputForm role="Admin" currentUserId="synthetic" currentTeam="TBCH" editMode />}
</NavigationGuardProvider>);
