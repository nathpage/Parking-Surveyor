# AI Agent Instructions for Parking Surveyor

## Project Overview
Parking Surveyor is a React-based web application for mapping and categorizing street parking data. It uses Leaflet for mapping functionality and Vite as the build tool.

## Architecture & Key Components

### Core Technologies
- React (v19) with functional components and hooks
- Leaflet with react-leaflet for mapping
- Vite for build tooling
- Local browser storage for data persistence
- i18n support (English/German)

### Main Components Structure
- `src/App.jsx`: Core application logic and UI components
- `src/exports/docs.js`: PDF/DOCX export functionality
- `src/i18n.js`: Internationalization translations
- `src/assets/`: Static assets and icons

### Key Data Flows
1. Map interactions → Leaflet/Geoman events → React state
2. React state → Local storage (automatic)
3. React state → Export formats (GeoJSON/PDF/DOCX)

## Development Workflow

### Local Development
```bash
npm install    # Install dependencies
npm run dev    # Start development server
```

### Build & Deployment
```bash
npm run build    # Build for production
npm run preview  # Preview production build
npm run publish  # One-command git commit + build + deploy
```

### Project Conventions

#### State Management
- Use React hooks for state (`useState`, `useRef`, `useEffect`)
- Prefer local component state over global state
- Persist user data in browser localStorage

#### Map Interactions
- All map editing done through Geoman.io controls
- Street segments stored as GeoJSON LineString features
- Study areas stored as GeoJSON Polygon features

#### Export Logic
- PDF/DOCX exports support both English and German
- Always include metadata (timestamp, area measurements)
- GeoJSON follows standard GIS coordinate order (lon, lat)

## Integration Points

### External Services
- OpenStreetMap data via Overpass API (with fallback endpoints)
- Base map tiles from OpenStreetMap
- Geoman.io for map drawing tools

### Key Dependencies
- @turf/turf: GIS calculations
- jspdf/docx: Document generation
- leaflet-geometryutil: Distance calculations

## Common Tasks

### Adding New Features
1. Update translations in `i18n.js` for all languages
2. Add UI components to `App.jsx`
3. Handle map interactions through Leaflet/Geoman events
4. Update export formats if needed

### Troubleshooting
- Check browser console for Leaflet/Geoman errors
- Verify localStorage availability for data persistence
- Test exports with different browser locales