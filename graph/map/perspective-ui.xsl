<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:mctx="gttp://ggg.maestro.ui/context" exclude-result-prefixes="mctx">
<xsl:output method="html" omit-xml-declaration="yes"/>
<xsl:template match="/mctx:context">
<section data-maestro-map="true" data-component-urn="{mctx:component/@uri}" data-provider-uri="{mctx:metadata/mctx:entry[@name='providerUri']}" class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Map perspective">
  <div class="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
    <label for="maestro-map-color-by" class="shrink-0 font-medium">Color by:</label>
    <select id="maestro-map-color-by" data-map-colorby="true" class="min-w-0 max-w-72 rounded-md border bg-background px-2 py-1 text-sm">
      <option value="">None</option>
      <xsl:for-each select="(mctx:query//*[local-name()='view'])[1]/../*[local-name()='property' or local-name()='property-of' or local-name()='class']">
        <xsl:variable name="direction"><xsl:choose><xsl:when test="local-name()='class'">class</xsl:when><xsl:when test="local-name()='property-of'">reverse</xsl:when><xsl:otherwise>forward</xsl:otherwise></xsl:choose></xsl:variable>
        <xsl:variable name="iri"><xsl:choose><xsl:when test="local-name()='class'">http://www.w3.org/1999/02/22-rdf-syntax-ns#type</xsl:when><xsl:otherwise><xsl:value-of select="@iri"/></xsl:otherwise></xsl:choose></xsl:variable>
        <option value="{concat($direction,'|',$iri)}" data-iri="{$iri}" data-direction="{$direction}">
          <xsl:choose><xsl:when test="local-name()='class'">Categories</xsl:when><xsl:otherwise><xsl:call-template name="local-label"><xsl:with-param name="uri" select="@iri"/></xsl:call-template><xsl:if test="$direction='reverse'"> of</xsl:if></xsl:otherwise></xsl:choose>
        </option>
      </xsl:for-each>
    </select>
    <span data-map-status="true" role="status" class="text-xs text-muted-foreground">Locating map resources…</span>
    <span data-map-error="true" role="alert" hidden="hidden" class="text-xs text-destructive"/>
  </div>
  <div class="flex min-h-[300px] min-w-0 flex-1 overflow-hidden">
    <div data-map-canvas="true" class="relative min-h-[300px] min-w-0 flex-1"/>
  </div>
  <div hidden="hidden">
    <textarea data-provider-field="queryXml"><xsl:value-of select="mctx:query-text"/></textarea>
    <xsl:for-each select="mctx:metadata/mctx:entry">
      <textarea data-provider-field="{@name}"><xsl:value-of select="."/></textarea>
    </xsl:for-each>
    <xsl:for-each select="mctx:facet-values/mctx:facet/mctx:term">
      <span data-facet-term="true" data-facet-key="{../@key}"><xsl:value-of select="."/></span>
    </xsl:for-each>
  </div>
  <script type="text/javascript"><![CDATA[
/* Map's entire service implementation is provider-owned. This script is
 * emitted by the Map XSLT and is not part of the Maestro application runtime. */
(async function () {
  const script = document.currentScript;
  const root = script && script.closest('[data-maestro-map]');
  const api = window.MaestroProvider;
  if (!root || !api) return;
  const urn = root.dataset.componentUrn;
  const signal = api.getMountSignal(urn);
  if (!signal || signal.aborted) return;
  const field = name => root.querySelector('[data-provider-field="' + name + '"]')?.value || '';
  const providerUri = root.dataset.providerUri;
  const queryXml = field('queryXml');
  const shapeUri = field('shapeUri');
  const queryStylesheet = field('queryStylesheet');
  const resultStylesheet = field('resultStylesheet');
  const paletteStylesheet = field('paletteStylesheet');
  const facetStylesheet = field('facetStylesheet');
  const addr = new DOMParser().parseFromString(queryXml, 'application/xml').documentElement.getAttribute('addr') || '';
  const select = root.querySelector('[data-map-colorby]');
  const status = root.querySelector('[data-map-status]');
  const error = root.querySelector('[data-map-error]');
  const canvas = root.querySelector('[data-map-canvas]');
  const facetOptions = Array.from(select.options).filter(option => option.value);
  const facetDefinitions = [...new Map(facetOptions.map(option => [option.value, {
    key: option.value, iri: option.dataset.iri, direction: option.dataset.direction,
    label: option.textContent.trim()
  }])).values()];
  for (const option of facetOptions) {
    if (option.textContent.includes('://')) {
      const iri = option.dataset.iri;
      const local = iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);
      try { option.textContent = decodeURIComponent(local) + (option.dataset.direction === 'reverse' ? ' of' : ''); }
      catch { option.textContent = local; }
    }
  }
  for (const facet of facetDefinitions) {
    facet.label = facetOptions.find(option => option.value === facet.key)?.textContent || facet.label;
  }
  const facetTerms = new Map();
  for (const node of root.querySelectorAll('[data-facet-term]')) {
    const key = node.getAttribute('data-facet-key');
    if (!facetTerms.has(key)) facetTerms.set(key, []);
    facetTerms.get(key).push(node.textContent || '');
  }
  const termKey = (value, datatype, lang) => JSON.stringify([
    value,
    datatype === 'http://www.w3.org/2001/XMLSchema#string' ||
      datatype === 'http://www.openlinksw.com/schemas/facets/dtp/plainstring' ? 'string' :
      (datatype || (lang ? '' : 'uri')),
    (lang || '').toLowerCase()
  ]);
  const currentQuery = new DOMParser().parseFromString(queryXml, 'application/xml');
  const view = Array.from(currentQuery.getElementsByTagName('*')).find(node => node.localName === 'view');
  const scope = view?.parentElement;
  const selectedTerms = selected => {
    const result = new Set();
    if (!scope || !selected) return result;
    for (const node of Array.from(scope.children)) {
      const direction = node.localName === 'class' ? 'class' : node.localName === 'property-of' ? 'reverse' : 'forward';
      const iri = node.localName === 'class' ? 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' : node.getAttribute('iri');
      if (direction + '|' + iri !== selected.key) continue;
      if (node.localName === 'class' && node.getAttribute('iri')) result.add(termKey(node.getAttribute('iri'), 'uri'));
      for (const val of Array.from(node.children).filter(n => n.localName === 'value')) {
        result.add(termKey(val.textContent || '', val.getAttribute('datatype') || (val.getAttribute('xml:lang') ? '' : 'string'), val.getAttribute('xml:lang') || ''));
      }
    }
    return result;
  };
  const parseXml = source => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid provider XML result');
    return doc;
  };
  const makeNode = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const localLabel = uri => {
    const label = uri.slice(Math.max(uri.lastIndexOf('#'), uri.lastIndexOf('/')) + 1);
    try { return decodeURIComponent(label); } catch { return label; }
  };
  let points = [];
  let palette = new Map();
  let markers = [];
  let map;
  let activeColorRequest;
  let resizeObserver;
  let themeObserver;
  let maplibre;
  signal.addEventListener('abort', () => {
    activeColorRequest?.abort();
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    markers.forEach(marker => marker.remove());
    if (map) { try { map.remove(); } catch { /* Browser worker already terminated */ } }
  }, { once: true });
  const showingError = (message) => { error.textContent = message || ''; error.hidden = !message; };
  const statusText = (message) => { status.textContent = message; };
  const setUrlColor = key => {
    const params = new URLSearchParams(window.location.search);
    if (key) params.set('colorBy', key); else params.delete('colorBy');
    window.history.replaceState(window.history.state, '', window.location.pathname + '?' + params.toString() + window.location.hash);
    if (key) {
      const separator = key.indexOf('|');
      window.dispatchEvent(new CustomEvent('maestro:colorby-selection', { detail: { direction: key.slice(0, separator), iri: key.slice(separator + 1) } }));
    }
  };
  const drawMarkers = () => {
    if (!map || !maplibre || signal.aborted) return;
    for (const marker of markers) marker.remove();
    markers = [];
    for (const point of points) {
      const dot = makeNode('div', 'size-4 rounded-full border-2 border-white shadow-lg');
      dot.style.backgroundColor = palette.get(point.colorTermKey) || '#7c3aed';
      const card = makeNode('div', 'max-w-72 rounded-lg bg-background p-3 text-foreground shadow-md');
      card.appendChild(makeNode('div', 'line-clamp-2 text-sm font-semibold', point.title === point.uri ? localLabel(point.uri) : point.title));
      card.appendChild(makeNode('div', 'mt-1 break-all text-xs text-muted-foreground', point.uri));
      const selected = facetDefinitions.find(facet => facet.key === select.value);
      if (selected && point.colorValue) card.appendChild(makeNode('div', 'mt-2 text-xs', selected.label + ': ' + point.colorValue));
      card.appendChild(makeNode('div', 'mt-1 text-xs tabular-nums text-muted-foreground', point.lat.toFixed(5) + ', ' + point.lng.toFixed(5)));
      const popup = new maplibre.Popup({ offset: 16, closeButton: false }).setDOMContent(card);
      const marker = new maplibre.Marker({ element: dot }).setLngLat([point.lng, point.lat]).addTo(map);
      dot.addEventListener('mouseenter', () => { if (!signal.aborted) popup.setLngLat([point.lng, point.lat]).addTo(map); });
      dot.addEventListener('mouseleave', () => popup.remove());
      dot.addEventListener('click', () => { if (!signal.aborted) popup.setLngLat([point.lng, point.lat]).addTo(map); });
      markers.push(marker);
    }
  };
  const publishDecorations = async () => {
    if (signal.aborted) return;
    const active = select.value;
    const specs = facetDefinitions.map(facet => ({
      iri: facet.iri, direction: facet.direction,
      items: facet.key === active ? [...new Set([...points.map(point => point.colorTermKey), ...(facetTerms.get(active) || [])].filter(Boolean))]
        .map(value => ({ value, color: palette.get(value) || '' })) : []
    }));
    await api.decorateFacets(providerUri, facetStylesheet, specs, active, (action, key) => {
      if (action !== 'toggle-colorby' || signal.aborted) return;
      select.value = select.value === key ? '' : key;
      void recolor();
    });
  };
  const projectionRows = (xml, projected, selected) => {
    const doc = parseXml(xml);
    const errorNode = Array.from(doc.getElementsByTagName('*')).find(node => node.localName === 'error');
    if (errorNode) throw new Error(errorNode.textContent || 'FCT projection failed');
    for (const row of Array.from(doc.getElementsByTagName('*')).filter(node => node.localName === 'row')) {
      const columns = Array.from(row.children).filter(node => node.localName === 'column');
      const uri = columns[0]?.textContent?.trim();
      if (!uri) continue;
      const existing = projected.get(uri) || new Map();
      for (const column of columns.slice(2)) {
        if (column.getAttribute('property') !== selected.iri || (column.getAttribute('direction') || 'forward') !== (selected.direction === 'class' ? 'forward' : selected.direction)) continue;
        for (const term of Array.from(column.children).filter(node => node.localName === 'value')) {
          const value = term.textContent || '';
          if (!value || value === '-') continue;
          const datatype = term.getAttribute('datatype') || (term.getAttribute('xml:lang') ? '' : 'string');
          const key = termKey(value, datatype, term.getAttribute('xml:lang') || '');
          existing.set(key, { value, termKey: key });
        }
      }
      projected.set(uri, existing);
    }
  };
  const doProjection = async (selected, requestSignal) => {
    const clone = parseXml(queryXml);
    const projectionView = Array.from(clone.getElementsByTagName('*')).find(node => node.localName === 'view');
    if (!projectionView) throw new Error('Live FCT query has no view');
    projectionView.setAttribute('type', 'list-values');
    projectionView.removeAttribute('badges');
    const projectionXml = new XMLSerializer().serializeToString(clone);
    const projected = new Map();
    for (let i = 0; i < points.length; i += 100) {
      if (requestSignal.aborted) return;
      const batch = points.slice(i, i + 100);
      const xml = await api.projectValues(projectionXml, batch.map(point => ({ type: 'uri', value: point.uri })),
        [{ property: selected.iri, direction: selected.direction === 'class' ? 'forward' : selected.direction }], requestSignal);
      projectionRows(xml, projected, selected);
    }
    if (requestSignal.aborted) return;
    const frequency = new Map();
    for (const terms of projected.values()) for (const term of terms.values()) frequency.set(term.termKey, (frequency.get(term.termKey) || 0) + 1);
    const filtered = selectedTerms(selected);
    points = points.map(point => {
      const choices = [...(projected.get(point.uri)?.values() || [])].sort((a, b) =>
        Number(filtered.has(b.termKey)) - Number(filtered.has(a.termKey)) ||
        (frequency.get(a.termKey) || 0) - (frequency.get(b.termKey) || 0) ||
        a.termKey.localeCompare(b.termKey));
      return { ...point, colorValue: choices[0]?.value || '', colorTermKey: choices[0]?.termKey || '' };
    });
  };
  const recolor = async () => {
    if (activeColorRequest) activeColorRequest.abort();
    activeColorRequest = new AbortController();
    const colorSignal = activeColorRequest.signal;
    const key = select.value;
    const selected = facetDefinitions.find(facet => facet.key === key);
    setUrlColor(key);
    showingError('');
    try {
      if (selected && points.length) await doProjection(selected, colorSignal);
      else points = points.map(point => ({ ...point, colorValue: '', colorTermKey: '' }));
      if (colorSignal.aborted || signal.aborted) return;
      const values = [...new Set([...points.map(point => point.colorTermKey), ...(facetTerms.get(key) || [])].filter(Boolean))].sort();
      const doc = document.implementation.createDocument(null, 'palette');
      for (const value of values) {
        const term = doc.createElement('term'); term.setAttribute('key', value); doc.documentElement.appendChild(term);
      }
      const paletteXml = await api.transformXml(paletteStylesheet, new XMLSerializer().serializeToString(doc), colorSignal);
      if (colorSignal.aborted || signal.aborted) return;
      palette = new Map(Array.from(parseXml(paletteXml).documentElement.children).map(node => [node.getAttribute('key'), node.getAttribute('hex')]));
      drawMarkers();
      await publishDecorations();
    } catch (reason) {
      if (!colorSignal.aborted && !signal.aborted) {
        showingError('Color By values unavailable: ' + (reason?.message || String(reason)));
        await publishDecorations();
      }
    }
  };
  select.addEventListener('change', () => { void recolor(); });
  const restored = new URLSearchParams(window.location.search).get('colorBy') || '';
  if (restored && facetDefinitions.some(facet => facet.key === restored)) select.value = restored;
  try {
    statusText('Locating map resources…');
    maplibre = await api.loadLibrary('maplibre-gl');
    if (signal.aborted) return;
    const dark = () => document.documentElement.classList.contains('dark');
    const style = () => dark() ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron';
    map = new maplibre.Map({ container: canvas, style: style(), center: [0, 15], zoom: 1 });
    map.addControl(new maplibre.NavigationControl(), 'top-right');
    map.addControl(new maplibre.FullscreenControl(), 'top-right');
    map.addControl(new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right');
    const fallback = { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] };
    let usedFallback = false;
    map.on('error', event => {
      if (!usedFallback && !map.isStyleLoaded()) { usedFallback = true; map.setStyle(fallback); }
      else if (!signal.aborted) showingError(event.error?.message || 'Map tiles unavailable');
    });
    themeObserver = new MutationObserver(() => { if (!signal.aborted && !usedFallback) map.setStyle(style()); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    resizeObserver = new ResizeObserver(() => { if (!signal.aborted) map.resize(); });
    resizeObserver.observe(canvas);
    const compiled = await api.compileQuery(queryXml, shapeUri, queryStylesheet, signal);
    const resultXml = await api.executeQuery({ kind: 'sparql', addr, sparql: compiled.sparql }, signal);
    const pointsXml = await api.transformXml(resultStylesheet, resultXml, signal);
    if (signal.aborted) return;
    const seen = new Set();
    points = Array.from(parseXml(pointsXml).documentElement.children).flatMap(node => {
      if (node.localName !== 'point') return [];
      const uri = node.getAttribute('uri');
      const lat = Number(node.getAttribute('lat'));
      const lng = Number(node.getAttribute('lng'));
      if (!uri || seen.has(uri) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
      seen.add(uri);
      return [{ uri, lat, lng, title: node.getAttribute('title') || uri, colorTermKey: '', colorValue: '' }];
    });
    statusText(points.length + ' mapped resources');
    if (points.length) {
      const bounds = new maplibre.LngLatBounds();
      points.forEach(point => bounds.extend([point.lng, point.lat]));
      map.resize();
      map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 0 });
    }
    await recolor();
  } catch (reason) {
    if (!signal.aborted) { statusText('Map query failed'); showingError(reason?.message || String(reason)); }
  }
})();

]]></script>
</section>
</xsl:template>
<xsl:template name="local-label">
  <xsl:param name="uri"/>
  <xsl:choose>
    <xsl:when test="contains($uri,'#')"><xsl:call-template name="local-label"><xsl:with-param name="uri" select="substring-after($uri,'#')"/></xsl:call-template></xsl:when>
    <xsl:when test="contains($uri,'/')"><xsl:call-template name="local-label"><xsl:with-param name="uri" select="substring-after($uri,'/')"/></xsl:call-template></xsl:when>
    <xsl:otherwise><xsl:value-of select="$uri"/></xsl:otherwise>
  </xsl:choose>
</xsl:template>
<!-- Compatibility with the existing generic facet decoration slots. -->
<xsl:template match="/context[@mode='facets']">
  <decorations>
    <xsl:apply-templates select="facets/facet" mode="decorate">
      <xsl:with-param name="colorDirection" select="@colorDirection"/>
      <xsl:with-param name="colorIri" select="@colorIri"/>
    </xsl:apply-templates>
  </decorations>
</xsl:template>
<xsl:template match="facet" mode="decorate">
  <xsl:param name="colorDirection"/><xsl:param name="colorIri"/>
  <xsl:variable name="isColorFacet" select="@direction=$colorDirection and @iri=$colorIri"/>
  <facet-decoration direction="{@direction}" iri="{@iri}">
    <control icon="paintbrush" action="toggle-colorby" active="{$isColorFacet}">
      <xsl:attribute name="label"><xsl:choose>
        <xsl:when test="$isColorFacet">Stop coloring map by this facet</xsl:when>
        <xsl:otherwise>Color map by this facet</xsl:otherwise>
      </xsl:choose></xsl:attribute>
    </control>
    <xsl:if test="$isColorFacet">
      <xsl:for-each select="item[string-length(@color) &gt; 0]">
        <item-decoration value="{@value}" color="{@color}"/>
      </xsl:for-each>
    </xsl:if>
  </facet-decoration>
</xsl:template>
</xsl:stylesheet>
