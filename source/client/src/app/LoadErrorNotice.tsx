import { useEffect, useState } from "react";

export function usePreloadError() {
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const preloadError = (event: Event) => {
			event.preventDefault();
			setFailed(true);
		};
		window.addEventListener("vite:preloadError", preloadError);
		return () => window.removeEventListener("vite:preloadError", preloadError);
	}, []);
	return failed;
}

export function LoadErrorNotice({
	failed,
	canReload,
}: {
	failed: boolean;
	canReload: boolean;
}) {
	if (!failed) return null;
	return (
		<aside className="load-error-notice" role="status" aria-label="Game files">
			<p>Game files could not be loaded.</p>
			{canReload ? (
				<button type="button" onClick={() => window.location.reload()}>
					Reload
				</button>
			) : (
				<p>Return to the main menu to reload.</p>
			)}
		</aside>
	);
}
