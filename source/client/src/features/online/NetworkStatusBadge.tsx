import { Wifi } from "lucide-react";
import type { NetworkQuality } from "../../network/contracts";

export function NetworkStatusBadge({ quality }: { quality: NetworkQuality }) {
	const { pingMs, avgPingMs, jitterMs, stalls, status } = quality;
	const title = `Ping: ${pingMs}ms | Avg: ${avgPingMs}ms | Jitter: ${jitterMs}ms | Stalls: ${stalls}`;

	return (
		<span
			role="status"
			className={`network-badge network-${status}`}
			title={title}
			aria-label={title}
		>
			<Wifi aria-hidden="true" />
			<span className="network-text">
				{pingMs > 0 ? `${pingMs}ms` : "Ping..."}
			</span>
		</span>
	);
}
