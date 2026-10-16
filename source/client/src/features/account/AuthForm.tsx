import { useState } from "react";
import { api, clearCsrf } from "../../network/api";
import type { Identity } from "../../network/contracts";

export function AuthForm({
	register,
	onSuccess,
	onSwitch,
}: {
	register: boolean;
	onSuccess: (identity: Identity) => void;
	onSwitch: () => void;
}) {
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	return (
		<>
			<form
				className="menu-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (pending) return;
					const data = new FormData(event.currentTarget);
					const password = String(data.get("password") || "");
					if (
						register &&
						([...password].length < 6 ||
							new TextEncoder().encode(password).length > 72)
					) {
						setError(
							"Password must have at least 6 characters and no more than 72 UTF-8 bytes",
						);
						return;
					}
					const body = {
						username: String(data.get("username")).trim(),
						password,
					};
					setPending(true);
					setError("");
					void api<Identity>(
						register ? "/auth/register" : "/auth/login",
						"POST",
						body,
					)
						.then((identity) => {
							if (!identity.authenticated || !identity.account)
								throw new Error("The server returned an invalid account");
							clearCsrf();
							onSuccess(identity);
						})
						.catch((cause) =>
							setError(
								cause instanceof Error ? cause.message : "Unable to sign in",
							),
						)
						.finally(() => setPending(false));
				}}
			>
				<label>
					Username
					<input
						name="username"
						autoComplete="username"
						required
						minLength={3}
						maxLength={32}
						pattern={"[\\p{L}\\p{N}_\\-]+"}
					/>
				</label>
				<label>
					Password
					<input
						type="password"
						name="password"
						autoComplete={register ? "new-password" : "current-password"}
						required
					/>
				</label>
				<button disabled={pending} type="submit">
					{pending ? "Please wait…" : register ? "Create Account" : "Sign In"}
				</button>
			</form>
			{error && <p role="alert">{error}</p>}
			<button type="button" onClick={onSwitch}>
				{register
					? "Already have an account? Sign In"
					: "New here? Create Account"}
			</button>
		</>
	);
}
