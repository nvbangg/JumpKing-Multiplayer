import { useEffect, useRef, useState } from "react";
import { api, clearCsrf } from "../../network/api";
import type { GameConfig, Identity } from "../../network/contracts";

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
							theme?: string;
							size?: string;
							text?: string;
							shape?: string;
							width?: string | number;
						},
					) => void;
					prompt: (
						momentListener?: (notification: {
							isNotDisplayed: () => boolean;
							isSkippedMoment: () => boolean;
							isDismissedMoment: () => boolean;
						}) => void,
					) => void;
				};
			};
		};
	}
}

export function AuthForm({
	onSuccess,
}: {
	onSuccess: (identity: Identity) => void;
}) {
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [googleClientId, setGoogleClientId] = useState<string | null>(
		() => import.meta.env.VITE_GOOGLE_CLIENT_ID || null,
	);
	const googleBtnRef = useRef<HTMLDivElement | null>(null);
	const authHandlerRef = useRef<(idToken: string) => void>(() => {});
	authHandlerRef.current = (idToken: string) => {
		setPending(true);
		setError("");
		void api<Identity>("/auth/google", "POST", { idToken })
			.then((identity) => {
				if (!identity.authenticated || !identity.account)
					throw new Error("The server returned an invalid account");
				clearCsrf();
				onSuccess(identity);
			})
			.catch((cause) =>
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to sign in with Google",
				),
			)
			.finally(() => setPending(false));
	};
	useEffect(() => {
		let active = true;
		if (!googleClientId) {
			void api<GameConfig>("/game-config")
				.then((config) => {
					if (!active) return;
					const clientId = config.auth?.googleClientId;
					if (clientId) setGoogleClientId(clientId);
				})
				.catch(() => {});
		}
		return () => {
			active = false;
		};
	}, [googleClientId]);

	useEffect(() => {
		if (!googleClientId) return;
		let active = true;

		const initGis = () => {
			if (!active || !window.google?.accounts?.id) return;
			try {
				window.google.accounts.id.initialize({
					client_id: googleClientId,
					callback: (response: { credential?: string }) => {
						if (!response.credential) return;
						authHandlerRef.current(response.credential);
					},
				});
				if (googleBtnRef.current) {
					googleBtnRef.current.innerHTML = "";
					window.google.accounts.id.renderButton(googleBtnRef.current, {
						theme: "outline",
						size: "large",
						text: "signin_with",
						shape: "rectangular",
						width: 280,
					});
				}
			} catch {
				// Bỏ qua lỗi khởi tạo GIS
			}
		};

		if (window.google?.accounts?.id) {
			initGis();
			return;
		}

		const scriptId = "google-jssdk";
		let script = document.getElementById(scriptId) as HTMLScriptElement | null;
		if (!script) {
			script = document.createElement("script");
			script.id = scriptId;
			script.src = "https://accounts.google.com/gsi/client";
			script.async = true;
			script.defer = true;
			document.head.appendChild(script);
		}
		script.addEventListener("load", initGis);

		return () => {
			active = false;
			script?.removeEventListener("load", initGis);
		};
	}, [googleClientId]);

	const triggerGooglePrompt = () => {
		if (!googleClientId) {
			setError(
				"Google Sign-In is not configured yet (missing GOOGLE_CLIENT_ID).",
			);
			return;
		}
		if (window.google?.accounts?.id) {
			window.google.accounts.id.prompt((notification) => {
				if (notification.isNotDisplayed()) {
					setError(
						"Google prompt was not displayed by browser. Check third-party cookies or browser popup settings.",
					);
				}
			});
		} else {
			setError("Google Sign-In SDK is loading or blocked by browser.");
		}
	};

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
			<div className="auth-divider">
				<span>or</span>
			</div>
			<div className="google-auth-container">
				<div ref={googleBtnRef} className="google-btn-slot" />
				<button
					type="button"
					className="google-auth-button"
					onClick={triggerGooglePrompt}
					disabled={pending}
					aria-label="Sign in with Google"
				>
					<span className="google-icon" aria-hidden="true">
						G
					</span>
					Sign in with Google
				</button>
			</div>
			{error && <p role="alert">{error}</p>}
		</>
	);
}
