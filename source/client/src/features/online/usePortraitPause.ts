import { useEffect, useRef } from "react";
import { useMobilePortrait } from "../../app/useMobilePortrait";

export function usePortraitPause(enabled: boolean, onPortrait: () => void) {
	const portrait = useMobilePortrait();
	const pause = useRef(onPortrait);
	pause.current = onPortrait;
	useEffect(() => {
		if (enabled && portrait) pause.current();
	}, [enabled, portrait]);
}
