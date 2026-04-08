type Listener = (id: string | undefined) => void;

let _current: string | undefined;
const _listeners = new Set<Listener>();

export const activeHighlightStore = {
	get: () => _current,
	set: (id: string | undefined) => {
		_current = id;
		_listeners.forEach((l) => l(id));
	},
	subscribe: (listener: Listener) => {
		_listeners.add(listener);
		return () => { _listeners.delete(listener); };
	},
};
