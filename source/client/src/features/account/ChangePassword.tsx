import { useState } from "react";
import { api, clearCsrf } from "../../network/api";
export function ChangePassword({ onChanged }: { onChanged: () => void }) {
	const [pending, setPending] = useState(false),
		[error, setError] = useState("");
	return (
		<form
			className="menu-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (pending) return;
				const data = new FormData(event.currentTarget);
				const newPassword = String(data.get("newPassword") || "");
				if (newPassword !== data.get("confirmPassword")) {
					setError("Passwords do not match");
					return;
				}
				setPending(true);
				setError("");
				void api("/auth/password", "POST", {
					currentPassword: String(data.get("currentPassword") || ""),
					newPassword,
				})
					.then(() => {
						clearCsrf();
						onChanged();
					})
					.catch((cause) =>
						setError(
							cause instanceof Error
								? cause.message
								: "Unable to change password",
						),
					)
					.finally(() => setPending(false));
			}}
		>
			<label>
				Current Password
				<input
					name="currentPassword"
					type="password"
					autoComplete="current-password"
					required
				/>
			</label>
			<label>
				New Password
				<input
					name="newPassword"
					type="password"
					autoComplete="new-password"
					required
					minLength={10}
				/>
			</label>
			<label>
				Confirm New Password
				<input
					name="confirmPassword"
					type="password"
					autoComplete="new-password"
					required
				/>
			</label>
			<button type="submit" disabled={pending}>
				{pending ? "Changing…" : "Change Password"}
			</button>
			{error && <p role="alert">{error}</p>}
		</form>
	);
}
