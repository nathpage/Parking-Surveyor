import { useEffect } from "react";

// Centralized dispatcher for pm:globaleditmodetoggled events per-map.
// Internally keeps a single listener on the map and notifies registered handlers.
const mapRegistry = new WeakMap(); // map -> { handlers: Set, dispatch }

export default function useGlobalEditGuard(map, handler) {
  useEffect(() => {
    if (!map || typeof handler !== 'function') return;

    let record = mapRegistry.get(map);
    if (!record) {
      const handlers = new Set();
      const dispatch = (e) => { try { handlers.forEach((h) => { try { h(e); } catch {} }); } catch {} };
      record = { handlers, dispatch };
      mapRegistry.set(map, record);
      try { map.on('pm:globaleditmodetoggled', dispatch); } catch {}
    }

    record.handlers.add(handler);

    return () => {
      try {
        record.handlers.delete(handler);
        if (record.handlers.size === 0) {
          try { map.off('pm:globaleditmodetoggled', record.dispatch); } catch {}
          mapRegistry.delete(map);
        }
      } catch {}
    };
  }, [map, handler]);
}
