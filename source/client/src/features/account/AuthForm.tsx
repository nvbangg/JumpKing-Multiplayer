import { LogIn, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PasswordField } from "../../components/PasswordField";
import { api, clearCsrf } from "../../network/api";
import type { GameConfig, Identity } from "../../network/contracts";
import { useResource } from "../../network/useResource";

declare global {
	interface Window {
		google?: {
			accounts?: {
				id?: {
					initialize: (config: {
						client_id: string;
						callback: (response: { credential?: string }) => void;
					}) => void;
					renderButton: (
						parent: HTMLElement,
						options: {
							theme: string;
							size: string;
							text: string;
							shape: string;
							width: number;
						},
					) => void;
				};
			};
		};
	}
}

// Dùng chung SDK khi mở lại form; tải thất bại vẫn cho phép Retry.
let googleSdk: Promise<void> | null = null;
function loadGoogleSdk() {
	if (window.google?.accounts?.id) return Promise.resolve();
	if (!googleSdk) {
		googleSdk = new Promise<void>((resolve, reject) => {
			const script = document.createElement("script");
			const failed = () => {
				googleSdk = null;
				script.remove();
				reject(new Error("Google Sign-In did not load"));
			};
			script.id = "google-jssdk";
			script.src = "https://accounts.google.com/gsi/client";
			script.async = true;
			script.onload = () =>
				window.google?.accounts?.id ? resolve() : failed();
			script.onerror = failed;
			document.head.appendChild(script);
		});
	}
	return googleSdk;
}

export function AuthForm({
	onSuccess,
}: {
	onSuccess: (identity: Identity) => void;
}) {
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [googleState, setGoogleState] = useState<"loading" | "ready" | "error">(
		"loading",
	);
	const [googleAttempt, setGoogleAttempt] = useState(0);
	const {
		data: config,
		error: configError,
		reload,
	} = useResource<GameConfig>("/game-config", {
		features: { flyEnabled: false },
		auth: { googleClientId: null },
	});
	const googleClientId = config.auth.googleClientId;
	const googleBtnRef = useRef<HTMLDivElement | null>(null);
	const mounted = useRef(false);
	const submitting = useRef(false);
	const authHandlerRef = useRef<(idToken: string) => void>(() => {});

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	async function signIn(path: string, body: unknown) {
		if (submitting.current || !mounted.current) return;
		submitting.current = true;
		setPending(true);
		setError("");
		try {
			const identity = await api<Identity>(path, "POST", body);
			if (!identity.authenticated || !identity.account)
				throw new Error("The server returned an invalid account");
			// Server đã đổi session; vẫn đồng bộ Account khi người dùng vừa rời form.
			clearCsrf();
			onSuccess(identity);
		} catch (cause) {
			if (mounted.current)
				setError(cause instanceof Error ? cause.message : "Unable to sign in");
		} finally {
			submitting.current = false;
			if (mounted.current) setPending(false);
		}
	}
	authHandlerRef.current = (idToken) => {
		void signIn("/auth/google", { idToken });
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: Chỉ tải lại SDK khi người dùng Retry.
	useEffect(() => {
		if (!googleClientId) return;
		let active = true;
		setGoogleState("loading");
		const slot = googleBtnRef.current;
		void loadGoogleSdk()
			.then(() => {
				if (!active || !slot) return;
				const google = window.google?.accounts?.id;
				if (!google) throw new Error("Google Sign-In did not load");
				google.initialize({
					client_id: googleClientId,
					callback: ({ credential }) => {
						if (active && credential) authHandlerRef.current(credential);
					},
				});
				slot.replaceChildren();
				google.renderButton(slot, {
					theme: "outline",
					size: "large",
					text: "signin_with",
					shape: "rectangular",
					width: 280,
				});
				setGoogleState("ready");
			})
			.catch(() => {
				if (active) setGoogleState("error");
			});
		return () => {
			active = false;
			slot?.replaceChildren();
		};
	}, [googleClientId, googleAttempt]);

	return (
		<>
			<form
				className="menu-form"
				onSubmit={(event) => {
					event.preventDefault();
					const data = new FormData(event.currentTarget);
					void signIn("/auth/login", {
						username: String(data.get("username")).trim(),
						password: String(data.get("password") || ""),
					});
				}}
			>
				<label className="form-field">
					Username
					<span className="input-wrap">
						<UserRound aria-hidden="true" />
						<input
							name="username"
							autoComplete="username"
							required
							pattern={"[\\p{L}\\p{N}_\\-]{3,32}"}
						/>
					</span>
				</label>
				<PasswordField
					label="Password"
					name="password"
					autoComplete="current-password"
				/>
				<button className="button-accent" disabled={pending} type="submit">
					<LogIn aria-hidden="true" />
					{pending ? "Please wait…" : "Sign In / Log In"}
				</button>
			</form>
			{(googleClientId || configError) && (
				<>
					<div className="auth-divider">
						<span>or</span>
					</div>
					<div className="google-auth-container">
						<div
							ref={googleBtnRef}
							className="google-btn-slot"
							inert={pending}
						/>
						{!configError && googleState === "loading" && (
							<p role="status">Loading Google Sign-In…</p>
						)}
						{(configError || googleState === "error") && (
							<>
								<p>Google Sign-In is unavailable.</p>
								<button
									type="button"
									disabled={pending}
									onClick={() => {
										if (configError) reload();
										else setGoogleAttempt((value) => value + 1);
									}}
								>
									Retry Google Sign-In
								</button>
							</>
						)}
					</div>
				</>
			)}
			{error && <p role="alert">{error}</p>}
		</>
	);
}
