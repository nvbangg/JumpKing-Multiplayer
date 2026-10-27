export interface ReconnectContext {
	roomId: string;
	playerId: string;
	reconnectToken: string;
}
const DATABASE = "jumpking-online";
function valid(value: unknown): value is ReconnectContext {
	if (!value || typeof value !== "object") return false;
	const context = value as ReconnectContext;
	return (
		typeof context.roomId === "string" &&
		/^[0-9]{6}$/.test(context.roomId) &&
		typeof context.playerId === "string" &&
		/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
			context.playerId,
		) &&
		typeof context.reconnectToken === "string" &&
		/^[A-Za-z0-9_-]{43}$/.test(context.reconnectToken)
	);
}
async function database(): Promise<IDBDatabase> {
	if (!globalThis.indexedDB)
		throw new Error("Reconnect storage is unavailable");
	return new Promise((resolve, reject) => {
		const open = indexedDB.open(DATABASE, 1);
		let blocked = false;
		open.onupgradeneeded = () => open.result.createObjectStore("memberships");
		open.onerror = () => reject(new Error("Reconnect storage is unavailable"));
		open.onblocked = () => {
			blocked = true;
			reject(
				new Error("Close other JumpKing tabs to update reconnect storage"),
			);
		};
		open.onsuccess = () => {
			if (blocked) {
				open.result.close();
				return;
			}
			open.result.onversionchange = () => open.result.close();
			resolve(open.result);
		};
	});
}
async function transaction<T>(
	mode: IDBTransactionMode,
	action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	const db = await database();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction("memberships", mode),
				request = action(tx.objectStore("memberships"));
			tx.oncomplete = () => resolve(request.result);
			tx.onabort = tx.onerror = () =>
				reject(
					new Error("Reconnect context could not be saved for this profile"),
				);
		});
	} finally {
		db.close();
	}
}
export async function saveReconnect(
	profile: string,
	value: unknown,
): Promise<void> {
	if (!valid(value)) throw new Error("Invalid reconnect context");
	const context = {
		roomId: value.roomId,
		playerId: value.playerId,
		reconnectToken: value.reconnectToken,
	};
	await transaction("readwrite", (store) => store.put(context, profile));
}
export async function loadReconnect(
	profile: string,
): Promise<ReconnectContext | null> {
	const value: unknown = await transaction("readonly", (store) =>
		store.get(profile),
	);
	return valid(value) ? value : null;
}
export async function clearReconnect(profile: string): Promise<void> {
	await transaction("readwrite", (store) => store.delete(profile));
}
