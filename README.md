====================================================================
🅿️ PARKING SURVEYOR
====================================================================

An interactive web application for mapping, categorizing, and exporting
street parking data anywhere in the world.

Built with React, Leaflet, and Vite, Parking Surveyor allows users to
draw street segments, define study areas, and generate exportable
reports for research, planning, or analysis.

====================================================================
🌐 LIVE DEMO
====================================================================

https://nathpage.github.io/Parking-Surveyor/

====================================================================
🧭 OVERVIEW
====================================================================

Parking Surveyor is designed for urban planners, researchers, and field
surveyors who need to collect and visualize parking data efficiently.

It provides an intuitive map interface for drawing, labeling, and
categorizing parking zones, and exports complete datasets for further
processing or reporting.

====================================================================
🗺️ FEATURES
====================================================================

🧩 INTERACTIVE MAPPING
 - Draw street segments, polygons, and rectangles
 - Categorize parking as:
   🟢 Free (anyone)
   🔴 Residents only
   🟠 Limited time

💾 AUTOMATIC LOCAL SAVING
 - Data is automatically stored in your browser (no server required)

📤 EXPORT OPTIONS
 - GeoJSON (for GIS tools)
 - PDF report
 - Word (DOCX) report

🌍 MULTILINGUAL INTERFACE
 - English (🇬🇧)
 - Deutsch (🇩🇪)

📱 RESPONSIVE AND MOBILE-FRIENDLY
 - Runs on desktop, tablet, and smartphone
 - Collapsible legend and side panel for a clean mobile interface

====================================================================
🧰 TECHNOLOGY STACK
====================================================================

Frontend:  React 19 + Vite
Mapping:   Leaflet + Leaflet-Geoman
Export:    jsPDF, docx, FileSaver
Hosting:   GitHub Pages
Styling:   Minimal inline design (CSS-in-JS)

====================================================================
💻 LOCAL SETUP
====================================================================

1️⃣ PREREQUISITES
 - Node.js (version 18 or newer)
 - npm (comes with Node)

2️⃣ INSTALLATION
   git clone https://github.com/nathpage/Parking-Surveyor.git
   cd Parking-Surveyor
   npm install

3️⃣ RUN LOCALLY
   npm run dev
   → open http://localhost:5173 in your browser

4️⃣ BUILD FOR PRODUCTION
   npm run build

5️⃣ DEPLOY TO GITHUB PAGES
   npm run deploy
   → https://nathpage.github.io/Parking-Surveyor/

====================================================================
🧾 USAGE GUIDE
====================================================================

1. Draw your study area using the polygon or rectangle tool.
2. Add parking segments using the line tool along the street.
3. Annotate each segment:
   - Category (Free / Residents / Limited)
   - Spaces, Rules, Time Limits, Notes
   - Optional Photos
4. Export your results:
   - GeoJSON for GIS analysis
   - Word or PDF for documentation
5. Autosave is enabled — use “Clear All Data” to reset.

====================================================================
💡 TIPS
====================================================================

 - Works offline after first load (localStorage-based).
 - You can import/export GeoJSON files between devices.
 - Zoom in for high-precision vertex placement.

====================================================================
🧑‍💻 DEVELOPER NOTES
====================================================================

 - Uses Leaflet-Geoman for interactive geometry editing.
 - Max zoom increased for precise mapping.
 - Touch logic optimized for mobile (tap for popup, edit via popup).
 - Legend and control panel are hidden by default.

====================================================================
⚖️ LICENSE — NON-COMMERCIAL WITH ATTRIBUTION
====================================================================

Copyright © 2025 Nathan Page

Permission is granted, free of charge, to any individual or organization
to use, copy, modify, and distribute this software for NON-COMMERCIAL and
ACADEMIC purposes only, provided that the following conditions are met:

1. The above copyright notice and this permission notice shall be
   included in all copies or substantial portions of the software.

2. Attribution must be given to the original author: Nathan Page.

3. Commercial use — defined as any use intended for or directed toward
   commercial advantage or monetary compensation — is NOT permitted
   without explicit written permission from the author. Commercial users
   must obtain a license agreement and pay royalties as determined by
   the author.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Author Contact: nathan@thepagefamily.co.za
Repository: https://github.com/nathpage/Parking-Surveyor
License version: 1.0 (January 2025)

====================================================================
🗺️ MAP DATA ATTRIBUTION
====================================================================

This project uses map data and tile imagery from **OpenStreetMap (OSM)**.

© OpenStreetMap contributors  
Data licensed under the [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1.0/).  
Map tiles provided by [OpenStreetMap.org](https://www.openstreetmap.org/).  
You are free to copy, distribute, transmit, and adapt OSM data, provided you credit 
“OpenStreetMap and its contributors” and share any derivative data under the same license.

Parking Surveyor complies with these terms by:
 - Displaying attribution within the map interface.
 - Using OSM tile servers for non-commercial, low-traffic, academic use.
 - Not redistributing or monetizing OSM map data.

For more details, visit: https://www.openstreetmap.org/copyright

====================================================================
🙏 ACKNOWLEDGEMENTS
====================================================================

 - Map data © OpenStreetMap contributors
 - Built using Leaflet-Geoman
 - Developed by Nathan Page
