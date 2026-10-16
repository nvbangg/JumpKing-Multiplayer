import { expect, test } from "vitest";
import { displayName, MAX_NAME_LABEL_LENGTH } from "./names";

test("displayName keeps short names and truncates long ones with an ellipsis", () => {
	expect(displayName("Player")).toBe("Player");
	const long = "a".repeat(MAX_NAME_LABEL_LENGTH + 5);
	expect(displayName(long)).toBe("a".repeat(MAX_NAME_LABEL_LENGTH) + "…");
	expect(Array.from(displayName("🎮".repeat(20)))).toHaveLength(
		MAX_NAME_LABEL_LENGTH + 1,
	);
});
