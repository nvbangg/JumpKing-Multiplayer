export interface Options {
	sound: boolean;
}
const key = "jumpking.options";
export function readOptions(): Options {
	try {
		const stored = JSON.parse(localStorage.getItem(key) || "{}");
		return {
			sound: typeof stored.sound === "boolean" ? stored.sound : true,
		};
	} catch {
		return { sound: true };
	}
}
export function saveOptions(options: Options): void {
	try {
		localStorage.setItem(key, JSON.stringify(options));
	} catch {
		// Vẫn dùng thiết lập trong RAM nếu trình duyệt không cho lưu.
	}
}
