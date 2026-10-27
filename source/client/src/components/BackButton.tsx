import { ArrowLeft } from "lucide-react";

export function BackButton({ onClick }: { onClick: () => void }) {
	return (
		<button type="button" className="back" onClick={onClick}>
			<ArrowLeft aria-hidden="true" /> Back
		</button>
	);
}
