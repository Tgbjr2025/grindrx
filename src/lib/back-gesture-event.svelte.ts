import { getContext, hasContext, setContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";

export const backGestureEventHandlers = new SvelteSet<() => boolean>();

// Upstream builds this on `createContext`, whose 3-tuple form (with
// `insideScreen`) only exists in Svelte >= 5.57; this project is on 5.55.5,
// where it returns `[get, set]` and `get` THROWS when unset. Reproducing the
// 5.57 shape on the 2-tuple API keeps `dismissOnBackGesture` callable outside a
// screen that sets the context, which is the whole reason upstream has the
// `insideScreen` check. Delete this and switch to `createContext` verbatim when
// svelte is upgraded.
const SCREEN_LEAVING_KEY = Symbol("screen-leaving");

type ScreenLeaving = () => boolean;

function setScreenLeaving(leaving: ScreenLeaving) {
	return setContext(SCREEN_LEAVING_KEY, leaving);
}

const insideScreen = () => hasContext(SCREEN_LEAVING_KEY);

const screenLeaving = () => getContext<ScreenLeaving>(SCREEN_LEAVING_KEY);

export { setScreenLeaving };

export function dismissOnBackGesture({
	active,
	dismiss,
}: {
	active: () => boolean;
	dismiss: () => void;
}): void {
	const leaving = insideScreen() ? screenLeaving() : () => false;
	$effect(() => {
		if (leaving() || !active()) return;
		const handler = () => {
			dismiss();
			return false;
		};
		backGestureEventHandlers.add(handler);
		return () => {
			backGestureEventHandlers.delete(handler);
		};
	});
}
