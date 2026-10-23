import { useState } from "react";
import { api, clearCsrf } from "../../network/api";
import type { Identity } from "../../network/contracts";

export function AuthForm({
	onSuccess,
}: {
	onSuccess: (identity: Identity) => void;
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
					const body = {
						username: String(data.get("username")).trim(),
						password,
					};
					setPending(true);
					setError("");
					void api<Identity>("/auth/login", "POST", body)
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
						pattern={"[\\p{L}\\p{N}_\\-]{3,32}"}
					/>
				</label>
				<label>
					Password
					<input
						type="password"
						name="password"
						autoComplete="current-password"
						required
					/>
				</label>
				<button disabled={pending} type="submit">
					{pending ? "Please wait…" : "Sign In / Log In"}
				</button>
			</form>
			{error && <p role="alert">{error}</p>}
		</>
	);
}
