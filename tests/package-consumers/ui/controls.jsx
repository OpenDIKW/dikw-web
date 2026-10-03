import React from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@opendikw/web-ui/controls";
import "@opendikw/web-ui/tokens.css";
import "@opendikw/web-ui/controls.css";
createRoot(document.getElementById("root")).render(<Button>Control</Button>);
