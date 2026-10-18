import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { required } from "./required";
import "./styles/main.css";

createRoot(required(document.getElementById("root"))).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
