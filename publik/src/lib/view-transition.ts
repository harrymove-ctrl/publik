type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();

export function onTransitionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setRouteMorph(active: boolean) {
  for (const listener of listeners) listener(active);
}
