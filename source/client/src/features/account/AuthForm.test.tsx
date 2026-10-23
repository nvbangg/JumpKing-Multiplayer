import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AuthForm } from "./AuthForm";

test("AuthForm renders username, password, submit button, and Google Sign-In button", () => {
	const html = renderToStaticMarkup(<AuthForm onSuccess={() => {}} />);
	expect(html).toContain('name="username"');
	expect(html).toContain('name="password"');
	expect(html).toContain("Sign In");
	expect(html).toContain("auth-divider");
	expect(html).toContain("Sign in with Google");
});
