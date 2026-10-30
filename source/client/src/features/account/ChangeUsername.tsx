import { UserRoundPen } from "lucide-react";
import { useId, useState } from "react";
import { api, clearCsrf } from "../../network/api";
import type { Identity } from "../../network/contracts";

export function ChangeUsername({
	username,
	onChanged,
}: {
	username: string;
	onChanged: (identity: Identity) => void;
}) {
	const inputId = useId();
	const [name, setName] = useState(username);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	return (
		<form
			className="menu-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (pending || name.trim() === username) return;
				const data = new FormData(event.currentTarget);
				setPending(true);
				setError("");
				void api<Identity>("/auth/username", "POST", {
					username: String(data.get("username") || "").trim(),
				})
					.then((identity) => {
						clearCsrf();
						onChanged(identity);
					})
					.catch((cause) =>
						setError(
							cause instanceof Error
								? cause.message
								: "Unable to change username",
						),
					)
					.finally(() => setPending(false));
			}}
		>
			<div className="form-field">
				<label htmlFor={inputId}>New Username</label>
				<span className="input-wrap">
					<UserRoundPen aria-hidden="true" />
					<input
						id={inputId}
						aria-describedby={`${inputId}-hint`}
						name="username"
						autoComplete="username"
						value={name}
						onChange={(event) => setName(event.target.value)}
						required
						pattern={"[\\p{L}\\p{N}_\\-]{3,32}"}
						disabled={pending}
					/>
				</span>
				<span id={`${inputId}-hint`} className="field-hint">
					3–32 letters, numbers, underscores or hyphens.
				</span>
			</div>
			<p className="field-hint">
				Use the new username to sign in. Other sessions will be signed out.
			</p>
			<button
				className="button-accent"
				type="submit"
				disabled={pending || name.trim() === username}
			>
				{pending ? "Changing…" : "Change Username"}
			</button>
			{error && <p role="alert">{error}</p>}
		</form>
	);
}
