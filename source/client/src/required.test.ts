import { expect, test } from "vitest";
import { required } from "./required";

test("required preserves values including falsy values", () => {
	for (const value of [0, false, "", {}, []])
		expect(required(value)).toBe(value);
});

test("required rejects absent values instead of hiding missing data", () => {
	for (const value of [null, undefined])
		expect(() => required(value)).toThrow("Missing required value");
});
