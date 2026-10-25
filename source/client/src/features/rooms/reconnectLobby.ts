/** Thử lại có giới hạn; nút Reconnect dùng cùng tác vụ với các lần tự động. */
export function reconnectLobby(reconnect: () => Promise<void>): () => void {
	let stopped = false,
		attempts = 0,
		running = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		if (stopped || running || attempts >= 5 || navigator.onLine === false)
			return;
		clearTimeout(timer);
		timer = setTimeout(
			() => {
				if (stopped || navigator.onLine === false) return;
				running = true;
				attempts++;
				void reconnect()
					.then(() => {
						stopped = true;
					})
					.catch(() => {})
					.finally(() => {
						running = false;
						schedule();
					});
			},
			1000 * 2 ** attempts,
		);
	};
	window.addEventListener("online", schedule);
	schedule();
	return () => {
		stopped = true;
		clearTimeout(timer);
		window.removeEventListener("online", schedule);
	};
}
