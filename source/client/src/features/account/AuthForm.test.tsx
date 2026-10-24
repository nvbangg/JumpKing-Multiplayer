import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AuthForm } from "./AuthForm";

test("AuthForm renders credentials without offering an unconfigured Google provider", () => {
	const html = renderToStaticMarkup(<AuthForm onSuccess={() => {}} />);
	expect(html).toContain('name="username"');
	expect(html).toContain('name="password"');
	expect(html).toContain("Sign In");
	expect(html).not.toContain("auth-divider");
	expect(html).not.toContain("google-btn-slot");
});
