import { useEffect, useRef } from "react";
import { MenuPanel } from "../components/MenuPanel";
import "./NewGameDialog.css";

export function NewGameDialog({
	onCancel,
	onConfirm,
}: {
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	return (
		<dialog
			ref={dialog}
			className="new-game-dialog"
			aria-labelledby="new-game-warning"
			onCancel={onCancel}
		>
			<MenuPanel>
				<p id="new-game-warning">Replace your unfinished game?</p>
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button type="button" className="button-danger" onClick={onConfirm}>
					Confirm
				</button>
			</MenuPanel>
		</dialog>
	);
}
