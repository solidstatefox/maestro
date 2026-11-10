Maestro SaxonJS browser/Node packaging correction
===================================================
1. One-time: node scripts/install-saxon-browser.mjs
   This downloads Saxonica's official SaxonJS 2.7 browser distribution and
   installs the unmodified SaxonJS2.js under public/vendor/saxon-js.
   Include this artifact in deployment/build output; it is needed for SPA XSLT.

2. In your EXISTING next.config.ts add saxon-js to serverExternalPackages:

   const nextConfig = {
     // ... your existing settings ...
     serverExternalPackages: ["saxon-js"],
   };

   If serverExternalPackages already exists, append "saxon-js" to its array.
   This prevents Turbopack from bundling SaxonJS2N.js and its fs dependency
   into Node app routes; the proxy still uses Node SaxonJS as before.

3. npm run build

IMPORTANT: Do NOT import `saxon-js` from a client .tsx module. The npm entry
point targets Node only. Client code uses the browser SaxonJS2.js distribution,
loaded during initial page loading by src/app/layout.tsx. No native
XSLTProcessor is used.

Licensing: SaxonJS is licensed separately by Saxonica; keep its original license
and notices when redistributing. See https://www.saxonica.com/html/download/javascript.html
