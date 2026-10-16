// Nhãn tên trên đầu nhân vật rút gọn để không che gameplay khi tên dài.
export const MAX_NAME_LABEL_LENGTH = 16;
export function displayName(nickname: string): string {
	const points = Array.from(nickname);
	if (points.length <= MAX_NAME_LABEL_LENGTH) return nickname;
	return points.slice(0, MAX_NAME_LABEL_LENGTH).join("") + "…";
}
