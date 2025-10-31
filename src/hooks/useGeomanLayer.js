import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { safeDisablePm, safeEnablePm, safeSetPmOptions, safeReInitLayer } from "../utils/geomanHelpers";
import useGlobalEditGuard from "./useGlobalEditGuard";

// Hook: wire Geoman behavior for a single leaflet layer ref
// - layerRef: React ref pointing to a Leaflet layer instance
// - feature: the GeoJSON feature this layer represents (used for _fid)
// - handlers: { onEdit(featureId, geo), onRemove(featureId) }
// - opts: { defaultPmOptions, enableOnGlobalEdit } (optional)
export default function useGeomanLayer(layerRef, feature, handlers = {}, opts = {}) {
  const map = useMap();
  // Global edit handler must be stable and available to the centralized guard.
  const handleGlobalEdit = (e) => {
    try {
      const layer = layerRef.current;
      if (!layer) return;
      if (e.enabled) {
        safeEnablePm(layer, { allowSelfIntersection: true, snappable: true });
      } else {
        safeDisablePm(layer);
      }
    } catch {}
  };

  // Register with centralized guard (no-op if map or handler invalid)
  useGlobalEditGuard(map, opts.skipWiring ? null : handleGlobalEdit);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !map?.pm) return;

    // set identifier for layer
    layer._fid = feature?.properties?._id;

    // keep edit OFF by default
    try { safeDisablePm(layer); } catch {}

    // set default pm options (if provided) - best-effort
    if (opts.defaultPmOptions && layer.pm) {
      try { safeSetPmOptions(layer, opts.defaultPmOptions); } catch {}
    }

    // reinit layer for Geoman
    try { safeReInitLayer(layer); } catch {}

    // optionally wire events (skip for non-editable layers like study boundary)
    let handleEdit, handleRemove;
    if (!opts.skipWiring) {
      handleEdit = () => {
        try {
          const geo = layer.toGeoJSON();
          handlers.onEdit?.(feature?.properties?._id, geo);
        } catch {}
      };
      handleRemove = () => {
        try { handlers.onRemove?.(feature?.properties?._id); } catch {}
      };

      layer.on("pm:edit", handleEdit);
      layer.on("pm:remove", handleRemove);
    }

    return () => {
      try { if (handleEdit) layer.off("pm:edit", handleEdit); } catch {}
      try { if (handleRemove) layer.off("pm:remove", handleRemove); } catch {}
      try { safeDisablePm(layer); } catch {}
    };
  }, [map, layerRef, feature, handlers, opts]);
}
