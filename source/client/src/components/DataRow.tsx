import type { ReactNode } from "react";

export function DataRow({
	label,
	icon,
	children,
	tone,
}: {
	label: string;
	icon: ReactNode;
	children: ReactNode;
	tone?: string;
}) {
	return (
		<div className="data-row">
			<dt>
				<span
					className={`data-icon ${tone || "tone-muted"}`}
					aria-hidden="true"
				>
					{icon}
				</span>
				{label}
			</dt>
			<dd>{children}</dd>
		</div>
	);
}
