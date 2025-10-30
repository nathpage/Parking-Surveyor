import { useEffect, useRef } from "react";
import { createGuidesFromFeatureCollection, safeDisablePm } from "../utils/geomanHelpers";
import * as turf from "@turf/turf";

// Hook to manage a single FeatureGroup of snap guides for a map
export default function useGuideManager(map) {
  const groupRef = useRef(null);

  useEffect(() => {
    return () => {
      try {
        if (groupRef.current) {
          try { map.removeLayer(groupRef.current); } catch {}
          groupRef.current = null;
        }
      } catch {}
    };
  }, [map]);

  const createFromFc = (fc, options = {}) => {
    try {
      if (!map) return null;
      // remove existing
      try { if (groupRef.current) { map.removeLayer(groupRef.current); } } catch {}
      groupRef.current = createGuidesFromFeatureCollection(map, fc);
      
      // configure global snapping if requested
      if (options.enableSnap) {
        try {
          map.pm.setGlobalOptions({ 
            snappable: true, 
            snapDistance: options.snapDistance ?? 60, 
            snapSegment: true, 
            snapMiddle: false 
          });
          map.pm.enableGlobalSnap?.();
        } catch {}
      }
      
      return groupRef.current;
    } catch (err) {
      console.warn("useGuideManager.createFromFc failed", err);
      return null;
    }
  };

  const removeAll = () => {
    try {
      if (groupRef.current) {
        try {
          // detach any pm global edit guard attached by the helper
          if (groupRef.current._ensureGuidesDisabled) {
            try { map.off('pm:globaleditmodetoggled', groupRef.current._ensureGuidesDisabled); } catch {}
          }
          try { map.removeLayer(groupRef.current); } catch {}
        } catch {}
        groupRef.current = null;
      }
      // also remove any stray _isSnapGuide layers
      try { map.eachLayer((lyr) => { if (lyr && lyr._isSnapGuide) { try { map.removeLayer(lyr); } catch {} } }); } catch {}
    } catch (err) {
      console.warn("useGuideManager.removeAll failed", err);
    }
  };

  const disableAll = () => {
    try {
      if (!groupRef.current) return;
      groupRef.current.eachLayer((lyr) => { try { safeDisablePm(lyr); } catch {} });
    } catch (err) {
      console.warn("useGuideManager.disableAll failed", err);
    }
  };

  const buildOffsetGuides = (roadFeature, side = "left", meters = 4) => {
    try {
      const dist = side === "left" ? meters : -meters;
      const off = turf.lineOffset(roadFeature, dist, { units: "meters" });
      const fc = turf.featureCollection([off]);
      removeAll();
      const group = createFromFc(fc, { enableSnap: true });
      return { group, offsetLine: off };
    } catch (err) {
      console.warn("useGuideManager.buildOffsetGuides failed", err);
      return { group: null, offsetLine: null };
    }
  };

  return { createFromFc, removeAll, disableAll, groupRef, buildOffsetGuides };
}
