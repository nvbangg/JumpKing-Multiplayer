import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useId, useState } from "react";

export function PasswordField({
	label,
	name,
	autoComplete,
	minLength,
	hint,
}: {
	label: string;
	name: string;
	autoComplete: "current-password" | "new-password";
	minLength?: number;
	hint?: string;
}) {
	const id = useId();
	const [visible, setVisible] = useState(false);
	return (
		<div className="form-field">
			<label htmlFor={id}>{label}</label>
			<div className="input-wrap">
				<LockKeyhole className="tone-amber" aria-hidden="true" />
				<input
					id={id}
					name={name}
					type={visible ? "text" : "password"}
					autoComplete={autoComplete}
					minLength={minLength}
					required
					aria-describedby={hint ? `${id}-hint` : undefined}
				/>
				<button
					type="button"
					className="icon-button password-toggle"
					aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
					aria-pressed={visible}
					onClick={() => setVisible((value) => !value)}
				>
					{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
				</button>
			</div>
			{hint && (
				<small id={`${id}-hint`} className="field-hint">
					{hint}
				</small>
			)}
		</div>
	);
}
