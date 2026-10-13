import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
} from "react";

export function MenuPanel({
	title,
	children,
	onBack,
}: {
	title?: string;
	children: ReactNode;
	onBack?: () => void;
}) {
	const ref = useRef<HTMLElement>(null);
	const selections = useRef<Record<string, string>>({});
	const key = title || "Main menu";
	useEffect(() => {
		const buttons = Array.from(
			ref.current?.querySelectorAll<HTMLButtonElement>(
				"button:not(:disabled)",
			) || [],
		);
		const selected = buttons.find(
			(button) => button.textContent === selections.current[key],
		);
		const first =
			ref.current?.querySelector<HTMLInputElement>("input") ||
			selected ||
			buttons[0];
		first?.focus({ preventScroll: true });
	}, [key]);
	const keyDown = useCallback(
		(event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => {
			if (event.key === "Escape" && onBack) {
				event.preventDefault();
				onBack();
				return;
			}
			if ((event.target as HTMLElement).closest("input,textarea,select"))
				return;
			if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
			const choices = Array.from(
				ref.current?.querySelectorAll<HTMLButtonElement>(
					"button:not(:disabled)",
				) || [],
			);
			if (!choices.length) return;
			event.preventDefault();
			const index = choices.indexOf(
				document.activeElement as HTMLButtonElement,
			);
			const next =
				event.key === "Home"
					? 0
					: event.key === "End"
						? choices.length - 1
						: (Math.max(0, index) +
								(event.key === "ArrowUp" ? -1 : 1) +
								choices.length) %
							choices.length;
			choices[next]?.focus();
		},
		[onBack],
	);
	useEffect(() => {
		const outside = (event: KeyboardEvent) => {
			if (
				!event.defaultPrevented &&
				(event.key === "Escape" || document.activeElement === document.body)
			)
				keyDown(event);
		};
		window.addEventListener("keydown", outside);
		return () => window.removeEventListener("keydown", outside);
	}, [keyDown]);
	return (
		<section
			ref={ref}
			className="menu-panel"
			aria-label={key}
			onFocusCapture={(event) => {
				const target = event.target as HTMLElement;
				if (target.tagName === "BUTTON")
					selections.current[key] = target.textContent || "";
			}}
			onKeyDown={keyDown}
		>
			{title && <h2>{title}</h2>}
			{children}
			{onBack && (
				<button type="button" className="back" onClick={onBack}>
					Back
				</button>
			)}
		</section>
	);
}
