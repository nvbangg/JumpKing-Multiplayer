import { expect, test } from "vitest";
import { duration } from "./format";

test("duration distinguishes no result, zero and elapsed hours", () => {
	expect(duration(null)).toBe("—");
	expect(duration(0)).toBe("00:00 s");
	expect(duration(61000)).toBe("01:01 s");
	expect(duration(3661999)).toBe("1:01:01 s");
});
