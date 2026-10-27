import { useState } from "react";
import { PasswordField } from "../../components/PasswordField";
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
			<PasswordField
				label="Current Password"
				name="currentPassword"
				autoComplete="current-password"
			/>
			<PasswordField
				label="New Password"
				name="newPassword"
				autoComplete="new-password"
				minLength={6}
				hint="At least 6 characters"
			/>
			<PasswordField
				label="Confirm New Password"
				name="confirmPassword"
				autoComplete="new-password"
			/>
			<button className="button-accent" type="submit" disabled={pending}>
				{pending ? "Changing…" : "Change Password"}
			</button>
			{error && <p role="alert">{error}</p>}
		</form>
	);
}
