import { useEffect, useState } from "react";
import { watchForUpdate } from "./updates";

export function UpdateNotice({ canReload }: { canReload: boolean }) {
	const [notice, setNotice] = useState<"update" | "load-error" | null>(null);
	useEffect(() => {
		const stop = watchForUpdate(import.meta.env.VITE_APP_VERSION, () =>
			setNotice("update"),
		);
		const preloadError = (event: Event) => {
			event.preventDefault();
			setNotice((value) => value || "load-error");
		};
		window.addEventListener("vite:preloadError", preloadError);
		return () => {
			stop();
			window.removeEventListener("vite:preloadError", preloadError);
		};
	}, []);
	if (!notice) return null;
	return (
		<aside className="update-notice" role="status" aria-label="Website update">
			<p>
				{notice === "update"
					? "New version available."
					: "Game files could not be loaded."}
			</p>
			{canReload ? (
				<button type="button" onClick={() => window.location.reload()}>
					{notice === "update" ? "Update now" : "Reload"}
				</button>
			) : (
				<p>
					Return to the main menu to {notice === "update" ? "update" : "reload"}
					.
				</p>
			)}
		</aside>
	);
}
