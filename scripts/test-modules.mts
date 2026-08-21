import Module from 'node:module'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { OpenAI } from 'openai'
import type { AIProviderConfig } from '../src/shared/types'
import type { AIConfigStore } from '../src/main/ai/config'

const ROOT = '/tmp/ptnotes-modules-test-root'
const PROJECT = 'Research Flow'

const origLoad = (Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load
;(Module as { _load: (r: string, p: unknown, m: boolean) => unknown })._load = function (
  request,
  parent,
  isMain
) {
  if (request === 'electron') {
    return {
      app: { getPath: () => ROOT, getAppPath: () => ROOT },
      shell: { showItemInFolder: () => {} }
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

await fs.rm(ROOT, { recursive: true, force: true })

const { PTNotesService } = await import('../src/main/service/PTNotesService')
const { ModuleRegistry } = await import('../src/main/modules/registry')
const { ModuleRunManager } = await import('../src/main/modules/runs')
const { createPptxModule } = await import('../src/main/modules/pptx')
const { buildPptx } = await import('../src/main/modules/pptx/builder')
const { createInfographicModule } = await import('../src/main/modules/infographic')
const { searchLucideIcons, getLucideIconSvg, lucideIconPngDataUri } =
  await import('../src/main/modules/shared/lucideIcons')

const service = new PTNotesService(ROOT)
await service.createProject(PROJECT)

// A config store that always returns a fixed (local) provider.
const configStore = {
  load: async (): Promise<AIProviderConfig> => ({
    baseUrl: 'http://127.0.0.1:9999/v1',
    apiKey: '',
    model: 'fake-model'
  }),
  save: async (c: AIProviderConfig) => c
} as unknown as AIConfigStore

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

// ---- buildPptx unit test ----
const deckOut = join(ROOT, 'probe-1.pptx')
const directDesign = {
  title: 'Probe deck',
  slides: [
    { layout: 'title', title: 'Hello from PTNotes', subtitle: 'automated test' },
    { layout: 'bullets', title: 'Agenda', body: ['First two', 'Details', 'Wrap-up'] },
    { layout: 'table', title: 'Plan', table: { headers: ['A', 'B'], rows: [['1', '2']] } }
  ]
}
const probeResult = await buildPptx(directDesign, deckOut)
assert.equal(probeResult.ok, true, 'valid design builds')
if (probeResult.ok) assert.equal(probeResult.slideCount, 3)
const stat = await fs.stat(deckOut)
assert.ok(stat.size > 100, 'pptx file has content')

const bad1 = await buildPptx({ slides: [] }, '/tmp/should-not-exist.pptx')
assert.equal(bad1.ok, false, 'empty slides rejected')
const bad2 = await buildPptx('not-an-object', '/tmp/should-not-exist2.pptx')
assert.equal(bad2.ok, false, 'non-object design rejected')

// ---- shared Lucide icon library ----
const hits = searchLucideIcons('chart')
assert.ok(hits.length > 0 && hits[0]!.name.startsWith('chart'), 'search returns chart icons')
const rocketHits = searchLucideIcons('rocket')
assert.ok(
  rocketHits.some((h) => h.name === 'rocket'),
  'search finds the rocket icon'
)
const rocketSvg = getLucideIconSvg('rocket', '#ED7D31')
assert.equal(rocketSvg.ok, true, 'rocket resolves')
if (rocketSvg.ok) {
  assert.ok(rocketSvg.svg.trimStart().startsWith('<svg'), 'returns svg source')
  assert.ok(rocketSvg.svg.includes('stroke="#ED7D31"'), 'stroke color injected')
}
const rocketPng = lucideIconPngDataUri('rocket', { color: '#ED7D31', sizePx: 128 })
assert.equal(rocketPng.ok, true, 'png renders')
if (rocketPng.ok) {
  const buf = Buffer.from(
    rocketPng.dataUri.slice(rocketPng.dataUri.indexOf('base64,') + 7),
    'base64'
  )
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'png magic bytes')
}
assert.equal(getLucideIconSvg('no-such-icon-xyz').ok, false, 'unknown icon rejected')

// ---- buildPptx with icons ----
const iconDesign = {
  title: 'Icon probe',
  slides: [
    { layout: 'title', title: 'Growth plan', icon: { name: 'trending-up', size: 1.0 } },
    { layout: 'section', statement: 'Results', icon: 'trending-up' },
    {
      layout: 'bullets',
      title: 'Details',
      body: ['A', 'B'],
      icon: { name: 'rocket', color: '#333333' }
    }
  ]
}
const iconOut = join(ROOT, 'probe-icons.pptx')
const iconRes = await buildPptx(iconDesign, iconOut)
assert.equal(iconRes.ok, true, 'icon design builds')
if (iconRes.ok) assert.equal(iconRes.slideCount, 3)
const iconStat = await fs.stat(iconOut)
assert.ok(iconStat.size > 100, 'icon pptx file has content')

const badIcon = await buildPptx(
  { slides: [{ layout: 'bullets', title: 'x', icon: 'no-such-icon' }] },
  join(ROOT, 'probe-bad-icon.pptx')
)
assert.equal(badIcon.ok, false, 'unknown icon name fails the build')

// ---- shared in-process chart engine ----
const { validateChart, renderChartPng } = await import('../src/main/modules/shared/chart')
const { createChartTools } = await import('../src/main/modules/shared/createChartTools')

const barDesign = {
  type: 'bar',
  data: {
    labels: ['Q1', 'Q2', 'Q3'],
    datasets: [{ label: 'Sales', data: [4, 7, 3], backgroundColor: '#1F4CA8' }]
  }
}
const cv = validateChart(barDesign)
assert.equal(cv.ok, true, 'valid chart accepted')
assert.equal(
  validateChart({ type: 'pie', data: { datasets: [{ data: [1, 2, 3] }] } }).ok,
  true,
  'pie chart accepted with numeric data'
)
assert.equal(
  validateChart({ type: 'nope', data: { datasets: [{ data: [1] }] } }).ok,
  false,
  'unknown chart type rejected'
)
assert.equal(
  validateChart({ type: 'bar', data: { datasets: [] } }).ok,
  false,
  'empty datasets rejected'
)
assert.equal(
  validateChart({ type: 'bar', data: { datasets: [{ data: Array(600).fill(1) }] } }).ok,
  false,
  'oversized dataset rejected'
)
assert.equal(
  validateChart({ type: 'scatter', data: { datasets: [{ data: [{ x: 1, y: 2 }] }] } }).ok,
  true,
  'scatter accepts {x,y} points'
)
assert.equal(
  validateChart({ type: 'scatter', data: { datasets: [{ data: [1, 2, 3] }] } }).ok,
  false,
  'scatter rejects plain numbers'
)

if (cv.ok) {
  const png = renderChartPng(cv.design, { width: 640, height: 360 })
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'bar chart png magic bytes')
  assert.ok(png.length > 100, 'bar chart png has content')
}

const pieChecked = validateChart({
  type: 'pie',
  data: { labels: ['A', 'B'], datasets: [{ data: [3, 5] }] }
})
assert.equal(pieChecked.ok, true, 'pie chart accepted')
if (pieChecked.ok) {
  const piePng = renderChartPng(pieChecked.design)
  assert.deepEqual(
    [...piePng.subarray(0, 4)],
    [0x89, 0x50, 0x4e, 0x47],
    'pie chart png magic bytes'
  )
}

// ---- chart tools (preview + render) ----
const chartTools = Object.fromEntries(
  createChartTools().map((t) => [t.definition.function.name, t])
)
const preview = await chartTools['chart_preview']!.execute(
  { chart: barDesign, outWidth: 640 },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const previewParsed = JSON.parse(preview)
assert.equal(previewParsed.ok, true, 'chart_preview succeeds')
assert.equal(previewParsed.chartType, 'bar', 'chart_preview reports the chart type')
assert.equal(previewParsed.width, 640, 'chart_preview honors outWidth')
assert.equal(previewParsed.pointCount, 3, 'chart_preview reports point count')

const rendered = await chartTools['render_chart']!.execute(
  { chart: barDesign, filename: 'sales-bar', outWidth: 800 },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const renderedParsed = JSON.parse(rendered)
assert.equal(renderedParsed.ok, true, 'render_chart succeeds')
assert.ok(
  typeof renderedParsed.png === 'string' && renderedParsed.png.endsWith('.png'),
  'render_chart returns a png path'
)
assert.equal(renderedParsed.path, undefined, 'render_chart deliberately omits path')
assert.equal(renderedParsed.file, undefined, 'render_chart deliberately omits file')
await fs.access(renderedParsed.png)
await fs.access(renderedParsed.json)

const badChartTools = chartTools['render_chart']!.execute(
  { chart: { type: 'pie', data: { datasets: [] } } },
  { service, activeProject: PROJECT, confirm: async () => false }
)
assert.equal(JSON.parse(await badChartTools).ok, false, 'render_chart rejects invalid charts')

// ---- buildPptx with a chart slide ----
const chartDeck = {
  title: 'Chart probe',
  slides: [
    { layout: 'title', title: 'Sales overview' },
    {
      layout: 'chart',
      title: 'Quarterly sales',
      chart: { png: renderedParsed.png }
    }
  ]
}
const chartOut = join(ROOT, 'probe-chart.pptx')
const chartRes = await buildPptx(chartDeck, chartOut)
assert.equal(chartRes.ok, true, 'chart slide builds')
if (chartRes.ok) assert.equal(chartRes.slideCount, 2)
const chartStat = await fs.stat(chartOut)
assert.ok(chartStat.size > 100, 'chart pptx has content')

const afterChart = await service.listFiles(PROJECT)
assert.ok(
  !afterChart.includes('sales-bar.png'),
  'chart temp png stays out of the project files folder'
)
assert.ok(
  renderedParsed.png.includes('/modules/temp/'),
  'render_chart png lands in <project>/modules/temp/'
)

const pptxTools = Object.fromEntries(
  createPptxModule().tools.map((t) => [t.definition.function.name, t])
)
const deckResult = await pptxTools['create_pptx_file']!.execute(
  { filename: 'chart-deck-cleanup', design: JSON.stringify(chartDeck) },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const deckParsed = JSON.parse(deckResult)
assert.equal(deckParsed.ok, true, 'create_pptx_file with a chart slide succeeds')
assert.ok(deckParsed.file?.endsWith('.pptx'), 'create_pptx_file returns the deck file name')
await assert.rejects(
  fs.access(renderedParsed.png),
  'temp chart png deleted after the deck is built'
)
await assert.rejects(
  fs.access(renderedParsed.json),
  'temp chart json deleted after the deck is built'
)

const missingPng = await buildPptx(
  { slides: [{ layout: 'chart', title: 'x', chart: { png: '/tmp/does-not-exist.png' } }] },
  join(ROOT, 'probe-bad-chart.pptx')
)
assert.equal(missingPng.ok, false, 'chart slide without a valid png fails the build')

// ---- shared in-process mermaid diagram engine ----
const { validateMermaid, renderMermaidSvg, svgBounds, svgToPng, renderMermaidPng } =
  await import('../src/main/modules/shared/mermaid')
const { createDiagramTools } = await import('../src/main/modules/shared/createDiagramTools')

const flowSrc = `flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[OK]
  B -->|No| D[Cancel]`

const flowValidation = await validateMermaid(flowSrc)
assert.equal(flowValidation.ok, true, 'valid flowchart accepted')
assert.ok(
  flowValidation.ok && /flowchart/.test(flowValidation.diagramType),
  'flowchart diagram type detected'
)
assert.equal(
  (await validateMermaid('this is not mermaid at all')).ok,
  false,
  'invalid mermaid rejected'
)
assert.equal((await validateMermaid('   ')).ok, false, 'empty diagram rejected')

const flowSvg = await renderMermaidSvg(flowSrc)
assert.ok(flowSvg.svg.trimStart().startsWith('<svg'), 'renderMermaidSvg returns svg source')
const flowBounds = svgBounds(flowSvg.svg)
assert.ok(flowBounds.width > 0 && flowBounds.height > 0, 'svgBounds reads the viewBox')

const seqSrc = `sequenceDiagram
  Alice->>John: Hello John, how are you?
  John-->>Alice: Great!`
const seqValidation = await validateMermaid(seqSrc)
assert.ok(
  seqValidation.ok && /sequence/.test(seqValidation.diagramType),
  'sequence diagram accepted'
)

const flowPng = svgToPng(flowSvg.svg)
assert.deepEqual(
  [...flowPng.subarray(0, 4)],
  [0x89, 0x50, 0x4e, 0x47],
  'mermaid svg to png magic bytes'
)
assert.ok(flowPng.length > 100, 'mermaid png has content')

const oneShot = await renderMermaidPng(flowSrc)
assert.deepEqual(
  [...oneShot.png.subarray(0, 4)],
  [0x89, 0x50, 0x4e, 0x47],
  'renderMermaidPng png magic bytes'
)
assert.ok(oneShot.diagramType.includes('flowchart'), 'renderMermaidPng reports the diagram type')
assert.ok(oneShot.width > 0, 'renderMermaidPng reports width')

// ---- diagram tools (preview + render) ----
const diagramTools = Object.fromEntries(
  createDiagramTools().map((t) => [t.definition.function.name, t])
)
const diagramPreview = await diagramTools['diagram_preview']!.execute(
  { diagram: flowSrc },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const diagramPreviewParsed = JSON.parse(diagramPreview)
assert.equal(diagramPreviewParsed.ok, true, 'diagram_preview succeeds')
assert.ok(
  /flowchart/.test(diagramPreviewParsed.diagramType),
  'diagram_preview reports the diagram type'
)
assert.ok(
  diagramPreviewParsed.width > 0 && diagramPreviewParsed.height > 0,
  'diagram_preview reports dimensions'
)

const badDiagramPreview = await diagramTools['diagram_preview']!.execute(
  { diagram: 'not a diagram!' },
  { service, activeProject: PROJECT, confirm: async () => false }
)
assert.equal(JSON.parse(badDiagramPreview).ok, false, 'diagram_preview rejects invalid mermaid')

const diagramRendered = await diagramTools['render_diagram']!.execute(
  { diagram: flowSrc, filename: 'flow-diagram', pixelWidth: 800 },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const diagramRenderedParsed = JSON.parse(diagramRendered)
assert.equal(diagramRenderedParsed.ok, true, 'render_diagram succeeds')
assert.ok(
  typeof diagramRenderedParsed.png === 'string' && diagramRenderedParsed.png.endsWith('.png'),
  'render_diagram returns a png path'
)
assert.ok(
  typeof diagramRenderedParsed.svg === 'string' && diagramRenderedParsed.svg.endsWith('.svg'),
  'render_diagram returns an svg path'
)
assert.equal(diagramRenderedParsed.path, undefined, 'render_diagram deliberately omits path')
assert.equal(diagramRenderedParsed.file, undefined, 'render_diagram deliberately omits file')
await fs.access(diagramRenderedParsed.png)
await fs.access(diagramRenderedParsed.svg)
await fs.access(diagramRenderedParsed.json)

// ---- gantt diagram support ----
const ganttSrc = `gantt
  title A Gantt Diagram
  dateFormat YYYY-MM-DD
  section Section
    A task :a1, 2024-01-01, 30d
    Another task :after a1, 20d`

const ganttValidation = await validateMermaid(ganttSrc)
assert.ok(
  ganttValidation.ok && ganttValidation.diagramType === 'gantt',
  'gantt diagram type detected'
)
const ganttSvg = await renderMermaidSvg(ganttSrc)
assert.ok(ganttSvg.svg.trimStart().startsWith('<svg'), 'renderMermaidSvg renders gantt')
const ganttBounds = svgBounds(ganttSvg.svg)
assert.ok(ganttBounds.width > 0 && ganttBounds.height > 0, 'gantt svgBounds reads the viewBox')

const ganttPreview = await diagramTools['diagram_preview']!.execute(
  { diagram: ganttSrc },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const ganttPreviewParsed = JSON.parse(ganttPreview)
assert.equal(ganttPreviewParsed.ok, true, 'gantt diagram_preview succeeds')
assert.equal(ganttPreviewParsed.diagramType, 'gantt', 'gantt diagram_preview reports the type')
assert.ok(
  ganttPreviewParsed.width > 0 && ganttPreviewParsed.height > 0,
  'gantt diagram_preview reports dimensions'
)

const ganttOneShot = await renderMermaidPng(ganttSrc)
assert.deepEqual(
  [...ganttOneShot.png.subarray(0, 4)],
  [0x89, 0x50, 0x4e, 0x47],
  'gantt renderMermaidPng png magic bytes'
)
assert.ok(ganttOneShot.diagramType === 'gantt', 'gantt renderMermaidPng reports the type')

const badDiagramTools = diagramTools['render_diagram']!.execute(
  { diagram: 'garbage text' },
  { service, activeProject: PROJECT, confirm: async () => false }
)
assert.equal(JSON.parse(await badDiagramTools).ok, false, 'render_diagram rejects invalid mermaid')

// ---- buildPptx with a diagram slide ----
const diagramDeck = {
  title: 'Diagram probe',
  slides: [
    { layout: 'title', title: 'Order flow' },
    {
      layout: 'diagram',
      title: 'Order decision flow',
      diagram: { png: diagramRenderedParsed.png }
    }
  ]
}
const diagramOut = join(ROOT, 'probe-diagram.pptx')
const diagramRes = await buildPptx(diagramDeck, diagramOut)
assert.equal(diagramRes.ok, true, 'diagram slide builds')
if (diagramRes.ok) assert.equal(diagramRes.slideCount, 2)
const diagramStat = await fs.stat(diagramOut)
assert.ok(diagramStat.size > 100, 'diagram pptx has content')

assert.ok(
  diagramRenderedParsed.png.includes('/modules/temp/'),
  'render_diagram png lands in <project>/modules/temp/'
)

const pptxDeckDiagram = await pptxTools['create_pptx_file']!.execute(
  { filename: 'diagram-deck-cleanup', design: JSON.stringify(diagramDeck) },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const deckDiagramParsed = JSON.parse(pptxDeckDiagram)
assert.equal(deckDiagramParsed.ok, true, 'create_pptx_file with a diagram slide succeeds')
await assert.rejects(
  fs.access(diagramRenderedParsed.png),
  'temp diagram png deleted after the deck is built'
)
await assert.rejects(
  fs.access(diagramRenderedParsed.svg),
  'temp diagram svg deleted after the deck is built'
)
await assert.rejects(
  fs.access(diagramRenderedParsed.json),
  'temp diagram json deleted after the deck is built'
)

const missingDiagramPng = await buildPptx(
  { slides: [{ layout: 'diagram', title: 'x', diagram: { png: '/tmp/does-not-exist.png' } }] },
  join(ROOT, 'probe-bad-diagram.pptx')
)
assert.equal(missingDiagramPng.ok, false, 'diagram slide without a valid png fails the build')

// ---- shared in-process @antv/infographic engine ----
const {
  validateInfographic,
  renderInfographicSvg,
  svgBounds: infoSvgBounds,
  svgToPng: infoSvgToPng,
  renderInfographicPng,
  listInfographicTemplates,
  stripXmlProcessingInstructions,
  replaceForeignObjectText
} = await import('../src/main/modules/shared/infographic')
const { createInfographicTools } = await import('../src/main/modules/shared/createInfographicTools')

const infoDsl = `infographic list-column-simple-vertical-arrow
data
  title Product rollout
  lists
    - label Research
      desc Market sizing
    - label Build
      desc Core features
    - label Launch
      desc Public release
`
const infoDslChecked = await validateInfographic(infoDsl)
assert.equal(infoDslChecked.ok, true, 'valid infographic DSL accepted')
assert.ok(
  infoDslChecked.ok && infoDslChecked.template === 'list-column-simple-vertical-arrow',
  'infographic DSL template detected'
)
assert.equal(
  (await validateInfographic('this is not infographic syntax')).ok,
  false,
  'invalid infographic DSL rejected'
)
assert.equal(
  (await validateInfographic({ template: 'no-such-template', data: { lists: [{ label: 'A' }] } }))
    .ok,
  false,
  'unknown infographic template rejected'
)
assert.equal(
  (await validateInfographic({ template: 'list-column-simple-vertical-arrow', data: {} })).ok,
  false,
  'infographic without data rejected'
)

const infoObjChecked = await validateInfographic({
  template: 'list-column-simple-vertical-arrow',
  data: { title: 'X', lists: [{ label: 'a', icon: 'rocket' }] },
  icon: 'stripped'
})
assert.equal(infoObjChecked.ok, true, 'infographic object form accepted')
if (infoObjChecked.ok) {
  const prepared = infoObjChecked.renderArgs as {
    data: { lists: { icon?: unknown }[] }
    icon?: unknown
  }
  assert.equal(prepared.icon, undefined, 'top-level icon stripped (not an item)')
  assert.equal(
    prepared.data.lists[0]?.icon,
    'mdi/rocket',
    'bare item icon canonicalized to mdi/<name> (local rendering)'
  )
}

// ---- icon normalization + auto-fill (mdi/<name> local icons) ----
const infoIconExplicit = await validateInfographic({
  template: 'list-column-vertical-icon-arrow',
  data: {
    lists: [
      { label: 'Config', icon: 'mdi/cog' },
      { label: 'Mail', icon: 'mdi/email' }
    ]
  }
})
assert.equal(infoIconExplicit.ok, true, 'infographic with explicit mdi icons accepted')
if (infoIconExplicit.ok) {
  const items = (infoIconExplicit.renderArgs as { data: { lists: { icon: string }[] } }).data.lists
  assert.equal(items[0].icon, 'mdi/cog', 'explicit mdi/<name> icon preserved')
  assert.equal(items[1].icon, 'mdi/email', 'second explicit mdi/<name> icon preserved')
}

const infoIconAuto = await validateInfographic({
  template: 'list-column-vertical-icon-arrow',
  data: { lists: [{ label: 'Configuration' }, { label: 'Email' }] }
})
assert.equal(infoIconAuto.ok, true, 'icon-named template accepted without explicit icons')
if (infoIconAuto.ok) {
  const items = (infoIconAuto.renderArgs as { data: { lists: { label: string; icon?: string }[] } })
    .data.lists
  assert.equal(
    items[0].icon,
    'mdi/cog',
    'auto-filled icon matches item label (Configuration → cog)'
  )
  assert.equal(items[1].icon, 'mdi/email', 'auto-filled icon matches item label (Email)')
}

const infoIconNonTemplate = await validateInfographic({
  template: 'list-column-simple-vertical-arrow',
  data: { lists: [{ label: 'a', icon: 'email' }, { label: 'Email' }] }
})
if (infoIconNonTemplate.ok) {
  const items = (
    infoIconNonTemplate.renderArgs as {
      data: { lists: { label: string; icon?: string }[] }
    }
  ).data.lists
  assert.equal(items[0].icon, 'mdi/email', 'explicit icon kept on any template')
  assert.equal(
    items[1].icon,
    'mdi/email',
    'icons auto-filled on any template, not only icon-named ones'
  )
}

const infoIconUnsupported = await validateInfographic({
  template: 'list-column-vertical-icon-arrow',
  data: {
    lists: [
      { label: 'a', icon: 'http://example.com/icon.svg' },
      { label: 'b', icon: 'gear' }
    ]
  }
})
if (infoIconUnsupported.ok) {
  const items = (
    infoIconUnsupported.renderArgs as { data: { lists: { label: string; icon?: string }[] } }
  ).data.lists
  assert.equal(items[0].icon, undefined, 'URL icons are dropped (no remote fetch)')
  assert.equal(items[1].icon, 'mdi/cog', 'bare icon name matched to mdi name (gear → cog)')
}

const infoIconRendered = await renderInfographicSvg({
  template: 'list-column-vertical-icon-arrow',
  data: {
    lists: [
      { label: 'Config', icon: 'mdi/cog' },
      { label: 'Mail', icon: 'mdi/email' }
    ]
  }
})
assert.ok(
  (infoIconRendered.svg.match(/<use\b/g) || []).length >= 2,
  'infographic with mdi icons renders <use> icon elements'
)
assert.ok(
  (infoIconRendered.svg.match(/<symbol\b/g) || []).length >= 2,
  'infographic with mdi icons embeds inline <symbol> resources (no remote fetch)'
)

const tpls = await listInfographicTemplates()
assert.ok(tpls.length > 100, `infographic template catalog has ${tpls.length} entries`)
assert.ok(
  tpls.some((t) => t.name === 'list-column-simple-vertical-arrow'),
  'infographic catalog lists a known template'
)

const infoSvg = await renderInfographicSvg(infoDsl)
assert.ok(
  infoSvg.svg.trimStart().startsWith('<?xml') || infoSvg.svg.includes('<svg'),
  'infographic svg rendered'
)
const infoBounds = infoSvgBounds(infoSvg.svg)
assert.ok(infoBounds.width > 0 && infoBounds.height > 0, 'infographic svgBounds read the size')
const infoPng1 = infoSvgToPng(infoSvg.svg, 800)
assert.deepEqual(
  [...infoPng1.subarray(0, 4)],
  [0x89, 0x50, 0x4e, 0x47],
  'infographic svg to png magic bytes'
)
assert.ok(infoPng1.length > 100, 'infographic png has content')
assert.ok(
  infoPng1.length > 4000,
  'infographic png is not empty of text (foreignObject → <text> conversion)'
)
const infoConvertedSvg = replaceForeignObjectText(stripXmlProcessingInstructions(infoSvg.svg))
assert.equal(
  infoConvertedSvg.includes('<foreignObject'),
  false,
  'all infographic foreignObject text blocks rewritten to <text>'
)
assert.ok(
  (infoConvertedSvg.match(/<text\b/g) || []).length >= 6,
  'infographic png text nodes (title + list labels/descs) present after conversion'
)
assert.ok(
  infoConvertedSvg.includes('Product rollout') && infoConvertedSvg.includes('>Research<'),
  'infographic converted <text> preserves the original strings'
)
assert.equal(
  replaceForeignObjectText('<svg><rect/></svg>'),
  '<svg><rect/></svg>',
  'replaceForeignObjectText leaves SVGs without foreignObject untouched'
)
assert.equal(
  stripXmlProcessingInstructions(infoSvg.svg).startsWith('<?xml'),
  false,
  'infographic xml processing instructions stripped'
)

const infoOneShot = await renderInfographicPng(infoDsl, 720)
assert.deepEqual(
  [...infoOneShot.png.subarray(0, 4)],
  [0x89, 0x50, 0x4e, 0x47],
  'renderInfographicPng png magic bytes'
)
assert.ok(
  infoOneShot.template === 'list-column-simple-vertical-arrow',
  'render reports the template'
)
assert.ok(infoOneShot.width > 0 && infoOneShot.height > 0, 'render reports infographic size')

// ---- infographic tools (templates + preview + render) ----
const infographicTools = Object.fromEntries(
  createInfographicTools().map((t) => [t.definition.function.name, t])
)
const tplList = await infographicTools['list_infographic_templates']!.execute(
  { category: 'sequence', query: 'timeline', limit: 20 },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const tplListParsed = JSON.parse(tplList)
assert.equal(tplListParsed.ok, true, 'list_infographic_templates succeeds')
assert.ok(tplListParsed.total > 0, 'list_infographic_templates finds timeline templates')
assert.ok(
  tplListParsed.templates.every((t: { category: string }) => t.category === 'sequence'),
  'list_infographic_templates honors the category filter'
)

const infoPreview = await infographicTools['infographic_preview']!.execute(
  { infographic: infoDsl, pixelWidth: 640 },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const infoPreviewParsed = JSON.parse(infoPreview)
assert.equal(infoPreviewParsed.ok, true, 'infographic_preview succeeds')
assert.equal(
  infoPreviewParsed.template,
  'list-column-simple-vertical-arrow',
  'infographic_preview reports the template'
)
assert.ok(
  infoPreviewParsed.width > 0 && infoPreviewParsed.height > 0,
  'infographic_preview reports dimensions'
)

const badInfoPreview = await infographicTools['infographic_preview']!.execute(
  { infographic: { template: 'nope', data: { lists: [{ label: 'A' }] } } },
  { service, activeProject: PROJECT, confirm: async () => false }
)
assert.equal(JSON.parse(badInfoPreview).ok, false, 'infographic_preview rejects unknown templates')

const infoRendered = await infographicTools['render_infographic']!.execute(
  { infographic: infoDsl, filename: 'rollout-timeline', pixelWidth: 800 },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const infoRenderedParsed = JSON.parse(infoRendered)
assert.equal(infoRenderedParsed.ok, true, 'render_infographic succeeds')
assert.ok(
  typeof infoRenderedParsed.png === 'string' && infoRenderedParsed.png.endsWith('.png'),
  'render_infographic returns a png path'
)
assert.ok(
  typeof infoRenderedParsed.svg === 'string' && infoRenderedParsed.svg.endsWith('.svg'),
  'render_infographic returns an svg path'
)
assert.equal(infoRenderedParsed.path, undefined, 'render_infographic deliberately omits path')
assert.equal(infoRenderedParsed.file, undefined, 'render_infographic deliberately omits file')
await fs.access(infoRenderedParsed.png)
await fs.access(infoRenderedParsed.svg)
await fs.access(infoRenderedParsed.json)

assert.ok(
  infoRenderedParsed.png.includes('/modules/temp/'),
  'render_infographic png lands in <project>/modules/temp/'
)

// ---- buildPptx with an infographic slide ----
const infoDeck = {
  title: 'Infographic probe',
  slides: [
    { layout: 'title', title: 'Rollout plan' },
    {
      layout: 'infographic',
      title: 'Rollout timeline',
      infographic: { png: infoRenderedParsed.png }
    }
  ]
}
const infoOut = join(ROOT, 'probe-infographic.pptx')
const infoRes = await buildPptx(infoDeck, infoOut)
assert.equal(infoRes.ok, true, 'infographic slide builds')
if (infoRes.ok) assert.equal(infoRes.slideCount, 2)
const infoStat = await fs.stat(infoOut)
assert.ok(infoStat.size > 100, 'infographic pptx has content')

const pptxDeckInfographic = await pptxTools['create_pptx_file']!.execute(
  { filename: 'infographic-deck-cleanup', design: JSON.stringify(infoDeck) },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const deckInfographicParsed = JSON.parse(pptxDeckInfographic)
assert.equal(deckInfographicParsed.ok, true, 'create_pptx_file with an infographic slide succeeds')
await assert.rejects(
  fs.access(infoRenderedParsed.png),
  'temp infographic png deleted after the deck is built'
)
await assert.rejects(
  fs.access(infoRenderedParsed.svg),
  'temp infographic svg deleted after the deck is built'
)
await assert.rejects(
  fs.access(infoRenderedParsed.json),
  'temp infographic json deleted after the deck is built'
)

const missingInfoPng = await buildPptx(
  { slides: [{ layout: 'infographic', title: 'x', infographic: { png: '/tmp/info.png' } }] },
  join(ROOT, 'probe-bad-infographic.pptx')
)
assert.equal(missingInfoPng.ok, false, 'infographic slide without a valid png fails the build')

// ---- standalone infographic module: create_infographic_file ----
const infoModuleTools = Object.fromEntries(
  createInfographicModule().tools.map((t) => [t.definition.function.name, t])
)
assert.equal(
  infoModuleTools['create_infographic_file'] !== undefined,
  true,
  'infographic module exposes create_infographic_file'
)
const infoFile = await infoModuleTools['create_infographic_file']!.execute(
  { infographic: infoDsl, filename: 'rollout-infographic', pixelWidth: 900 },
  { service, activeProject: PROJECT, confirm: async () => false }
)
const infoFileParsed = JSON.parse(infoFile)
assert.equal(infoFileParsed.ok, true, 'create_infographic_file succeeds')
assert.ok(
  typeof infoFileParsed.path === 'string' && infoFileParsed.path.endsWith('.svg'),
  'create_infographic_file returns the .svg deliverable path'
)
assert.equal(typeof infoFileParsed.file, 'string', 'create_infographic_file returns the file name')
assert.ok(
  typeof infoFileParsed.png === 'string' && infoFileParsed.png.endsWith('.png'),
  'create_infographic_file reports the .png path'
)
await fs.access(infoFileParsed.png)
const afterInfoFile = await service.listFiles(PROJECT)
assert.ok(
  afterInfoFile.includes(infoFileParsed.file),
  'infographic deliverable is in the project files folder'
)

const badInfoFile = await infoModuleTools['create_infographic_file']!.execute(
  { infographic: { template: 'nope', data: { lists: [{ label: 'A' }] } } },
  { service, activeProject: PROJECT, confirm: async () => false }
)
assert.equal(JSON.parse(badInfoFile).ok, false, 'create_infographic_file rejects unknown templates')

// ---- simulate a full module run with a scripted model ----
interface FakeToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function step(id: string, name: string, args: Record<string, unknown>): FakeToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

const script: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [
      step('c1', 'set_plan', {
        steps: ['Design the deck', 'Draft slide content', 'Generate the pptx file']
      })
    ]
  },
  { tool_calls: [step('c2', 'update_step', { index: 1, status: 'running' })] },
  {
    tool_calls: [
      step('c3', 'update_step', { index: 1, status: 'done' }),
      step('c4', 'update_step', { index: 2, status: 'running' })
    ]
  },
  {
    tool_calls: [
      step('c5', 'update_step', { index: 2, status: 'done' }),
      step('c6', 'update_step', { index: 3, status: 'running' })
    ]
  },
  {
    tool_calls: [
      step('c7', 'update_step', { index: 3, status: 'done' }),
      step('c8', 'create_pptx_file', {
        filename: 'quarterly-deck',
        design: JSON.stringify({
          title: 'Quarterly Review',
          slides: [
            { layout: 'title', title: 'Quarterly Review', subtitle: 'Q1 highlights' },
            { layout: 'bullets', title: 'Highlights', body: ['Strong growth', 'New features'] }
          ]
        })
      })
    ]
  },
  { content: 'Done. Generated quarterly-review.pptx.' }
]

const fakeClientFactory = makeScriptedClient(script)

function makeScriptedClient(
  scriptArr: { content?: string; tool_calls?: FakeToolCall[] }[]
): (cfg: AIProviderConfig) => OpenAI {
  let i = 0
  return () => {
    return {
      chat: {
        completions: {
          create: async () => {
            const entry = scriptArr[i++] ?? scriptArr[scriptArr.length - 1]!
            const message: Record<string, unknown> = {
              role: 'assistant',
              content: entry.content ?? ''
            }
            if (entry.tool_calls) message.tool_calls = entry.tool_calls
            return { choices: [{ message }] }
          }
        }
      }
    } as unknown as OpenAI
  }
}

const eventTypes: string[] = []
const registry = new ModuleRegistry()
registry.register(createPptxModule())
const manager = new ModuleRunManager(
  service,
  configStore,
  registry,
  (evt) => {
    eventTypes.push(evt.type)
  },
  fakeClientFactory
)

const started = await manager.start(
  PROJECT,
  'pptx',
  'Quarterly Review deck',
  'Build a quarterly review presentation with a title slide and highlights.'
)
assert.equal(started.ok, true, 'start accepts a valid module')
const runId = started.ok ? started.runId : ''

await waitFor(async () => {
  const runs = await manager.list(PROJECT)
  return runs.some((r) => r.runId === runId && (r.status === 'done' || r.status === 'failed'))
})

const run = (await manager.list(PROJECT)).find((r) => r.runId === runId)
assert.ok(run, 'run exists in manager list')
assert.equal(run!.status, 'done', 'run finished as done')
assert.equal(run!.steps.length, 3)
assert.ok(
  run!.steps.every((s) => s.status === 'done'),
  'all steps marked done'
)
assert.ok(
  run!.steps.every((s) => typeof s.updatedAt === 'number' && s.updatedAt > 0),
  'each step has a status-change timestamp'
)
assert.ok(run!.outputFile && run!.outputFile.endsWith('.pptx'), 'output file captured')
assert.ok(
  Array.isArray(run!.outputFiles) && run!.outputFiles.length === 1,
  'single-output module records exactly one outputFiles entry'
)
const outStat = await fs.stat(run!.outputFile!)
assert.ok(outStat.size > 100, 'output pptx exists on disk')
assert.ok(eventTypes.includes('step'), 'step events were broadcast')
assert.ok(eventTypes.includes('output'), 'output event was broadcast')
assert.ok(eventTypes.includes('done'), 'done event was broadcast')

const stored = await service.listStoredModuleRuns(PROJECT)
const storedRun = stored.find((s) => s.runId === runId)
assert.ok(storedRun, 'run persisted under project modules dir')
assert.ok(
  storedRun!.steps.every((s) => typeof s.updatedAt === 'number'),
  'step timestamps persisted in the JSON run file'
)

const unknown = await manager.start(PROJECT, 'nope', 'x', 'y')
assert.equal(unknown.ok, false, 'unknown module rejected')

const edge = await manager.start(PROJECT, 'pptx', '', 'no title')
assert.equal(edge.ok, false, 'empty title rejected')

const cleared = await manager.clearHistory(PROJECT)
assert.equal(cleared, 1, 'clearHistory removes the just-finished run')
const afterClear = await manager.list(PROJECT)
assert.ok(!afterClear.some((r) => r.runId === runId), 'finished run no longer listed')
assert.equal(
  (await service.listStoredModuleRuns(PROJECT)).some((r) => r.runId === runId),
  false,
  'run file removed from disk'
)

// ---- full infographic module run (scripted model → create_infographic_file) ----
const infoScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [
      step('i1', 'set_plan', { steps: ['Pick a template', 'Author the design', 'Build the file'] })
    ]
  },
  { tool_calls: [step('i2', 'update_step', { index: 1, status: 'done' })] },
  {
    tool_calls: [
      step('i3', 'list_infographic_templates', { query: 'arrow' }),
      step('i4', 'infographic_preview', { infographic: infoDsl })
    ]
  },
  {
    tool_calls: [
      step('i5', 'create_infographic_file', {
        filename: 'standalone-infographic',
        infographic: infoDsl
      })
    ]
  },
  { content: 'Done. Saved standalone-infographic.svg to the project files.' }
]
const infoRegistry = new ModuleRegistry()
infoRegistry.register(createInfographicModule())
const infoManager = new ModuleRunManager(
  service,
  configStore,
  infoRegistry,
  () => {},
  makeScriptedClient(infoScript)
)
const infoStart = await infoManager.start(
  PROJECT,
  'infographic',
  'Launch infographic',
  'Build a rollout timeline infographic.'
)
assert.equal(infoStart.ok, true, 'infographic module run accepted')
const infoRunId = infoStart.ok ? infoStart.runId : ''
await waitFor(async () => {
  const runs = await infoManager.list(PROJECT)
  return runs.some((r) => r.runId === infoRunId && (r.status === 'done' || r.status === 'failed'))
})
const infoRun = (await infoManager.list(PROJECT)).find((r) => r.runId === infoRunId)
assert.ok(infoRun, 'infographic run exists')
assert.equal(infoRun!.status, 'done', 'infographic run finished done')
assert.ok(
  infoRun!.outputFile && infoRun!.outputFile.endsWith('.svg'),
  'infographic output file captured'
)
assert.ok(
  Array.isArray(infoRun!.outputFiles) && infoRun!.outputFiles.length === 2,
  'infographic module records BOTH .svg and .png outputs'
)
assert.ok(
  infoRun!.outputFiles!.every((p) => p.endsWith('.svg') || p.endsWith('.png')),
  'multi-file output list contains only svg/png deliverables'
)
const infoOutStat = await fs.stat(infoRun!.outputFile!)
assert.ok(infoOutStat.size > 100, 'infographic output svg exists on disk')
const infoFiles = await service.listFiles(PROJECT)
assert.ok(
  infoFiles.includes('standalone-infographic.svg'),
  'standalone infographic module delivers into <project>/files/'
)
assert.ok(
  infoFiles.includes('standalone-infographic.png'),
  'standalone infographic module delivers the matching .png alongside the .svg'
)
const infoDel = await infoManager.deleteRun(PROJECT, infoRunId, true)
assert.equal(infoDel, true, 'infographic run deletable')
const infoFilesAfterDel = await service.listFiles(PROJECT)
assert.ok(
  !infoFilesAfterDel.includes('standalone-infographic.svg') &&
    !infoFilesAfterDel.includes('standalone-infographic.png'),
  'deleting the run with deleteOutputFiles removes BOTH the .svg and .png'
)

// ---- disabled module enforcement ----
const { SettingsStore } = await import('../src/main/settings')
const settingsStore = new SettingsStore()
await settingsStore.save({ rootDir: ROOT, disabledModules: ['pptx'] })
const gatedManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  undefined,
  settingsStore
)
const disabledStart = await gatedManager.start(
  PROJECT,
  'pptx',
  'Blocked deck',
  'This should be refused.'
)
assert.equal(disabledStart.ok, false, 'disabled module refused')
await settingsStore.save({ rootDir: ROOT, disabledModules: [] })
const reEnabled = await gatedManager.start(PROJECT, 'pptx', 'Now allowed', 'Should start.')
assert.equal(reEnabled.ok, true, 're-enabled module accepted')
const reRunId = reEnabled.ok ? reEnabled.runId : ''
await waitFor(async () => {
  const runs = await gatedManager.list(PROJECT)
  return runs.some((r) => r.runId === reRunId && (r.status === 'done' || r.status === 'failed'))
})

// infographic module honors the same disabled gate
const infoGatedManager = new ModuleRunManager(
  service,
  configStore,
  infoRegistry,
  () => {},
  undefined,
  settingsStore
)
await settingsStore.save({ rootDir: ROOT, disabledModules: ['infographic'] })
const infoDisabledStart = await infoGatedManager.start(
  PROJECT,
  'infographic',
  'Blocked infographic',
  'Should be refused.'
)
assert.equal(infoDisabledStart.ok, false, 'disabled infographic module refused')
await settingsStore.save({ rootDir: ROOT, disabledModules: [] })

// ---- step status cascade: later step done promotes earlier running/pending steps ----
const cascadeScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [step('f1', 'set_plan', { steps: ['Research', 'Draft', 'Generate'] })]
  },
  { tool_calls: [step('f2', 'update_step', { index: 1, status: 'running' })] },
  // jump straight to step 3 done, leaving step 1 running and step 2 pending
  { tool_calls: [step('f3', 'update_step', { index: 3, status: 'done' })] },
  {
    tool_calls: [
      step('f4', 'create_pptx_file', {
        filename: 'cascade-deck',
        design: JSON.stringify({
          title: 'Cascade',
          slides: [{ layout: 'title', title: 'Cascade' }]
        })
      })
    ]
  },
  { content: 'Done.' }
]
const cascadeManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  makeScriptedClient(cascadeScript)
)
const cStart = await cascadeManager.start(PROJECT, 'pptx', 'Cascade deck', 'Use short steps.')
assert.equal(cStart.ok, true, 'cascade run accepted')
const cRunId = cStart.ok ? cStart.runId : ''
await waitFor(async () => {
  const runs = await cascadeManager.list(PROJECT)
  return runs.some((r) => r.runId === cRunId && (r.status === 'done' || r.status === 'failed'))
})
const cRun = (await cascadeManager.list(PROJECT)).find((r) => r.runId === cRunId)
assert.ok(cRun, 'cascade run exists')
assert.equal(cRun!.status, 'done', 'cascade run finished')
assert.equal(cRun!.steps[0]!.status, 'done', 'previous running step promoted to done')
assert.equal(cRun!.steps[1]!.status, 'done', 'previous pending step promoted to done')
assert.equal(cRun!.steps[2]!.status, 'done', 'target step stays done')

// ---- premature finish without the output tool is not silently "done" ----
const prematureScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [step('p1', 'set_plan', { steps: ['Research', 'Draft', 'Generate'] })]
  },
  { content: 'I have all the data, here is my summary.' }
]
const prematureManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  makeScriptedClient(prematureScript)
)
const pStart = await prematureManager.start(PROJECT, 'pptx', 'No output deck', 'Do the work.')
assert.equal(pStart.ok, true, 'premature run accepted')
const pRunId = pStart.ok ? pStart.runId : ''
await waitFor(async () => {
  const runs = await prematureManager.list(PROJECT)
  return runs.some((r) => r.runId === pRunId && (r.status === 'done' || r.status === 'failed'))
})
const pRun = (await prematureManager.list(PROJECT)).find((r) => r.runId === pRunId)
assert.ok(pRun, 'premature run exists')
assert.equal(pRun!.status, 'failed', 'run without an output file ends failed, not done')
assert.ok(!pRun!.outputFile, 'no output file produced')
assert.match(pRun!.error ?? '', /output file/, 'failure mentions the missing output file')

// ---- module result channel: submit_result stores the payload + 'result' event ----
const resultEvents: string[] = []
const resultScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [
      step('r1', 'set_plan', { steps: ['Build deck', 'Generate file', 'Submit result'] })
    ]
  },
  {
    tool_calls: [
      step('r2', 'create_pptx_file', {
        filename: 'result-deck',
        design: JSON.stringify({
          title: 'Result deck',
          slides: [{ layout: 'title', title: 'Result deck' }]
        })
      })
    ]
  },
  {
    tool_calls: [step('r3', 'submit_result', { result: '{"title":"Result deck","slides":1}' })]
  },
  { content: 'Done.' }
]
const resultManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  (evt) => {
    if (evt.type === 'result') resultEvents.push(evt.result ?? '')
  },
  makeScriptedClient(resultScript)
)
const rStart = await resultManager.start(
  PROJECT,
  'pptx',
  'Result deck',
  'Build a deck and submit the result.',
  'Return a JSON object with keys {title, slides}'
)
assert.equal(rStart.ok, true, 'result run accepted')
const rRunId = rStart.ok ? rStart.runId : ''
await waitFor(async () => {
  const runs = await resultManager.list(PROJECT)
  return runs.some((r) => r.runId === rRunId && (r.status === 'done' || r.status === 'failed'))
})
const rRun = (await resultManager.list(PROJECT)).find((r) => r.runId === rRunId)
assert.ok(rRun, 'result run exists')
assert.equal(rRun!.status, 'done', 'result run finished done')
assert.equal(
  rRun!.expectResult,
  'Return a JSON object with keys {title, slides}',
  'expectResult stored on the run'
)
assert.equal(rRun!.result, '{"title":"Result deck","slides":1}', 'submit_result stored the payload')
assert.ok(
  resultEvents.includes('{"title":"Result deck","slides":1}'),
  "'result' event broadcast to listeners"
)
const rStored = (await service.listStoredModuleRuns(PROJECT)).find((s) => s.runId === rRunId)
assert.equal(
  rStored?.result,
  '{"title":"Result deck","slides":1}',
  'result persisted in the stored run JSON'
)
assert.equal(rStored?.expectResult, 'Return a JSON object with keys {title, slides}')

// ---- waitForRuns unit cases ----
// already-terminal run resolves immediately with its result
const wRes = await resultManager.waitForRuns(PROJECT, [rRunId], 200)
assert.equal(wRes.length, 1, 'one wait result returned')
assert.equal(wRes[0]!.runId, rRunId, 'wait result runId matches')
assert.equal(wRes[0]!.status, 'done', 'already-terminal run resolves immediately')
assert.equal(wRes[0]!.module, 'PowerPoint (PPTX)', 'wait result includes the module name')
assert.equal(
  wRes[0]!.result,
  '{"title":"Result deck","slides":1}',
  'wait result surfaces the payload'
)

// unknown run returns an error entry
const wUnknown = await resultManager.waitForRuns(PROJECT, ['no-such-run'], 200)
assert.equal(wUnknown.length, 1, 'unknown run returns one entry')
assert.equal(wUnknown[0]!.status, 'unknown', 'unknown run entry status is unknown')
assert.match(wUnknown[0]!.error ?? '', /Unknown run/, 'unknown run entry carries an error')

// input order preserved across mixed terminal + unknown ids
const wMixed = await resultManager.waitForRuns(PROJECT, ['no-such-run', rRunId], 200)
assert.equal(wMixed.length, 2, 'mixed wait returns both entries')
assert.equal(wMixed[0]!.status, 'unknown', 'first mixed entry is the unknown run')
assert.equal(wMixed[1]!.status, 'done', 'second mixed entry is the terminal run')

// in-flight run resolves when it completes
function makeDelayedScriptedClient(
  scriptArr: { content?: string; tool_calls?: FakeToolCall[] }[],
  delayMs: number
): (cfg: AIProviderConfig) => OpenAI {
  let i = 0
  return () => {
    return {
      chat: {
        completions: {
          create: async () => {
            await new Promise((r) => setTimeout(r, delayMs))
            const entry = scriptArr[i++] ?? scriptArr[scriptArr.length - 1]!
            const message: Record<string, unknown> = {
              role: 'assistant',
              content: entry.content ?? ''
            }
            if (entry.tool_calls) message.tool_calls = entry.tool_calls
            return { choices: [{ message }] }
          }
        }
      }
    } as unknown as OpenAI
  }
}

const inflightScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  { tool_calls: [step('w1', 'set_plan', { steps: ['Build deck', 'Generate'] })] },
  {
    tool_calls: [
      step('w2', 'create_pptx_file', {
        filename: 'inflight-deck',
        design: JSON.stringify({
          title: 'Inflight',
          slides: [{ layout: 'title', title: 'Inflight' }]
        })
      })
    ]
  },
  { content: 'Done.' }
]
const inflightManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  makeDelayedScriptedClient(inflightScript, 150)
)
const iStart = await inflightManager.start(PROJECT, 'pptx', 'Inflight deck', 'Build a deck.')
assert.equal(iStart.ok, true, 'inflight run accepted')
const iRunId = iStart.ok ? iStart.runId : ''
const waitStart = Date.now()
const wInflight = await inflightManager.waitForRuns(PROJECT, [iRunId], 5000)
assert.equal(wInflight[0]!.status, 'done', 'in-flight run resolves when it completes')
assert.equal(wInflight[0]!.result, undefined, 'no result expected on a plain run')
assert.ok(Date.now() - waitStart >= 100, 'waitForRuns actually waited for the run to finish')

// timeout marks still-pending entries
const slowManager = new ModuleRunManager(
  service,
  configStore,
  registry,
  () => {},
  makeDelayedScriptedClient(inflightScript, 300)
)
const sStart = await slowManager.start(PROJECT, 'pptx', 'Slow deck', 'Build a deck.')
assert.equal(sStart.ok, true, 'slow run accepted')
const sRunId = sStart.ok ? sStart.runId : ''
const wTimeout = await slowManager.waitForRuns(PROJECT, [sRunId], 150)
assert.equal(wTimeout[0]!.status, 'timeout', 'timeout marks still-pending entries')
slowManager.stop(sRunId)

// isStopped resolves early with status stopped
const s2Start = await slowManager.start(PROJECT, 'pptx', 'Slow deck 2', 'Build a deck.')
assert.equal(s2Start.ok, true, 'second slow run accepted')
const s2RunId = s2Start.ok ? s2Start.runId : ''
const wStopped = await slowManager.waitForRuns(PROJECT, [s2RunId], 5000, () => true)
assert.equal(wStopped[0]!.status, 'stopped', 'isStopped cancels the wait early')
slowManager.stop(s2RunId)

// ---- general-purpose subagent module (long-run agent, no required output file) ----
const { createSubagentModule } = await import('../src/main/modules/subagent')
const subRegistry = new ModuleRegistry()
subRegistry.register(createSubagentModule())
const subDef = subRegistry.get('subagent')
assert.ok(subDef, 'subagent module registered')
assert.equal(subDef!.outputTool, undefined, 'subagent has no required output tool')
assert.ok((subDef!.maxIterations ?? 30) > 30, 'subagent gets a larger turn budget')

const subagentScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [
      step('sa1', 'set_plan', { steps: ['Research', 'Summarize', 'Save a note', 'Submit result'] })
    ]
  },
  { tool_calls: [step('sa2', 'update_step', { index: 1, status: 'done' })] },
  { tool_calls: [step('sa3', 'web_search', { query: 'electron security' })] },
  {
    tool_calls: [
      step('sa4', 'create_note', {
        title: 'Subagent findings',
        content: '# Findings\n\nDeep research summary.'
      })
    ]
  },
  {
    tool_calls: [
      step('sa5', 'submit_result', { result: '{"note":"subagent-findings","sources":3}' })
    ]
  },
  { content: 'Done. Researched and saved a note.' }
]
const subManager = new ModuleRunManager(
  service,
  configStore,
  subRegistry,
  () => {},
  makeScriptedClient(subagentScript)
)
const subStart = await subManager.start(
  PROJECT,
  'subagent',
  'Deep research',
  'Research Electron security best practices and save the findings as a note.',
  'Return a JSON object with keys {note, sources}'
)
assert.equal(subStart.ok, true, 'subagent run accepted')
const subRunId = subStart.ok ? subStart.runId : ''
await waitFor(async () => {
  const runs = await subManager.list(PROJECT)
  return runs.some((r) => r.runId === subRunId && (r.status === 'done' || r.status === 'failed'))
})
const subRun = (await subManager.list(PROJECT)).find((r) => r.runId === subRunId)
assert.ok(subRun, 'subagent run exists')
assert.equal(subRun!.status, 'done', 'subagent run finished done (no output file required)')
assert.equal(subRun!.outputFile, undefined, 'subagent run needs no deliverable file')
assert.equal(
  subRun!.result,
  '{"note":"subagent-findings","sources":3}',
  'subagent submitted its result'
)
assert.match(subRun!.summary ?? '', /Researched/, 'subagent finishes with a summary')
assert.ok(
  subRun!.steps.every((s) => s.status === 'done'),
  'subagent steps all done'
)
const subNoteExists = await fs
  .readFile(`${ROOT}/${PROJECT}/notes/subagent-findings.md`, 'utf8')
  .then((c) => c.includes('Deep research'))
  .catch(() => false)
assert.ok(subNoteExists, 'subagent used base tools to persist a note')

// ---- raw AI trace: module runs record every turn to <project>/.data/modules/ ----
let modTrace: Awaited<ReturnType<typeof service.readModuleTrace>> = null
await waitFor(async () => {
  modTrace = await service.readModuleTrace(PROJECT, rRunId)
  return modTrace !== null
})
assert.ok(modTrace, 'module trace file written for the result run')
assert.equal(modTrace!.key, rRunId)
assert.equal(modTrace!.kind, 'module')
assert.equal(modTrace!.project, PROJECT)
assert.deepEqual(
  modTrace!.entries.map((e) => e.role),
  ['system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant'],
  'module trace is a readable log: system → user → (assistant → tool) × 3 → final assistant'
)
const assistantRoles = modTrace!.entries.filter((e) => e.role === 'assistant')
assistantRoles.forEach((e) => {
  assert.equal(e.endpoint, 'chat.completions')
  assert.equal(e.model, 'fake-model')
  assert.ok(typeof e.durationMs === 'number', 'module assistant entry records duration')
})
const setPlanAssistant = modTrace!.entries[2]!
const setPlanTrace = (setPlanAssistant.toolCalls ?? []).find((tc) => tc.name === 'set_plan')
assert.ok(setPlanTrace, 'module trace captures the set_plan tool call')
assert.ok(
  Array.isArray(setPlanTrace!.args.steps) && setPlanTrace!.args.steps.length === 3,
  'module trace captures the tool call payload (args)'
)
const setPlanTool = modTrace!.entries[3]!
assert.equal(setPlanTool.role, 'tool')
assert.equal(setPlanTool.name, 'set_plan')
assert.equal(setPlanTool.toolCallId, setPlanTrace!.id)
assert.match(setPlanTool.content ?? '', /steps/, 'module tool response recorded')
assert.ok(typeof setPlanTool.durationMs === 'number', 'module tool entry records duration')
assert.ok(
  modTrace!.entries[0]!.content?.includes('You are the'),
  'module trace includes the system prompt'
)
assert.match(
  modTrace!.entries[8]!.content ?? '',
  /Done/,
  'final module trace entry carries the assistant reply'
)
assert.ok(
  !JSON.stringify(modTrace).includes('fake-api-key'),
  'module trace never contains the API key'
)

const liveTrace = await resultManager.readTrace(PROJECT, rRunId)
assert.ok(liveTrace, 'manager.readTrace returns the persisted module trace')
assert.ok(
  typeof liveTrace!.path === 'string' && liveTrace!.path.endsWith('.trace.jsonl'),
  'module trace read exposes the absolute path'
)
const modTraceRaw = await fs.readFile(modTrace!.path!, 'utf8')
const modTraceLines = modTraceRaw.split('\n').filter((l) => l.trim() !== '')
assert.equal(
  modTraceLines.length,
  modTrace!.entries.length + 1,
  'module trace file is JSONL: header record + one line per entry'
)
const modTraceHeader = JSON.parse(modTraceLines[0]!) as Record<string, unknown>
assert.equal(modTraceHeader.type, 'header', 'first module trace record is the run header')
assert.equal(modTraceHeader.key, rRunId)
assert.equal(modTraceHeader.kind, 'module')
assert.ok(
  (await service.listStoredModuleRuns(PROJECT)).every((r) => !r.runId.includes('.trace')),
  'trace files never surface as module runs'
)

const delTraceRun = await resultManager.deleteRun(PROJECT, rRunId, false)
assert.equal(delTraceRun, true, 'result run deletable')
assert.equal(
  await service.readModuleTrace(PROJECT, rRunId),
  null,
  'deleting a run removes its .trace.jsonl file'
)

// ---- modules can read skills (index injected) but never mutate them ----
await service.saveSkill(PROJECT, 'project', 'pt-style', {
  description: 'PTNotes house style guide',
  content: '# Style\n\nUse active voice.',
  enabled: true
})

// capture the `tools` array each scripted completion receives
const offeredToolNames: string[] = []
function makeCapturingClient(
  scriptArr: { content?: string; tool_calls?: FakeToolCall[] }[]
): (cfg: AIProviderConfig) => OpenAI {
  let i = 0
  return () =>
    ({
      chat: {
        completions: {
          create: async (params: { tools?: { function: { name: string } }[] }) => {
            for (const t of params.tools ?? []) offeredToolNames.push(t.function.name)
            const entry = scriptArr[i++] ?? scriptArr[scriptArr.length - 1]!
            const message: Record<string, unknown> = {
              role: 'assistant',
              content: entry.content ?? ''
            }
            if (entry.tool_calls) message.tool_calls = entry.tool_calls
            return { choices: [{ message }] }
          }
        }
      }
    }) as unknown as OpenAI
}

const skillSubScript: { content?: string; tool_calls?: FakeToolCall[] }[] = [
  {
    tool_calls: [
      step('sk1', 'set_plan', {
        steps: ['Load the style skill', 'Write the note', 'Submit result']
      })
    ]
  },
  {
    tool_calls: [
      step('sk2', 'read_skill', { scope: 'project', name: 'pt-style' }),
      step('sk3', 'update_step', { index: 1, status: 'done' })
    ]
  },
  { tool_calls: [step('sk4', 'submit_result', { result: 'ok' })] },
  { content: 'Done.' }
]
const skillManager = new ModuleRunManager(
  service,
  configStore,
  subRegistry,
  () => {},
  makeCapturingClient(skillSubScript)
)
const skillStart = await skillManager.start(
  PROJECT,
  'subagent',
  'Use the style skill',
  'Write the note using the pt-style skill.',
  'Return the string "ok"'
)
assert.equal(skillStart.ok, true, 'skill-enabled subagent run accepted')
const skillRunId = skillStart.ok ? skillStart.runId : ''
await waitFor(async () => {
  const runs = await skillManager.list(PROJECT)
  return runs.some((r) => r.runId === skillRunId && (r.status === 'done' || r.status === 'failed'))
})

const skillToolNames = new Set(offeredToolNames)
assert.ok(skillToolNames.has('read_skill'), 'modules are offered read_skill')
assert.ok(skillToolNames.has('read_skill_file'), 'modules are offered read_skill_file')
assert.ok(!skillToolNames.has('create_skill'), 'modules are NOT offered create_skill (read-only)')
assert.ok(!skillToolNames.has('delete_skill'), 'modules are NOT offered delete_skill (read-only)')
assert.ok(!skillToolNames.has('ask_user'), 'modules are not offered ask_user')

const skillModTrace = await service.readModuleTrace(PROJECT, skillRunId)
assert.ok(skillModTrace, 'skill-enabled module trace written')
const skillSystemPrompt = skillModTrace!.entries.find((e) => e.role === 'system')?.content ?? ''
assert.match(
  skillSystemPrompt,
  /pt-style — PTNotes house style guide/,
  'module system prompt lists enabled skills in the index'
)
assert.match(
  skillSystemPrompt,
  /Call the read_skill tool/,
  'module system prompt explains read_skill'
)

// with no enabled skills, the index is omitted from the module system prompt
const skillModTraceRun = await skillManager.deleteRun(PROJECT, skillRunId, false)
assert.equal(skillModTraceRun, true, 'skill-enabled run deleted')
const skillBefore = await service.renderSkillsIndex(PROJECT)
assert.match(skillBefore, /pt-style/, 'sanity: skill index populated before disabling')

await service.setSkillEnabled(PROJECT, 'project', 'pt-style', false)
const noSkillIndex = await service.renderSkillsIndex(PROJECT)
assert.equal(noSkillIndex.trim(), '', 'disabled skills are excluded from the index')
const noSkillManager = new ModuleRunManager(
  service,
  configStore,
  subRegistry,
  () => {},
  makeScriptedClient(skillSubScript)
)
const noSkillStart = await noSkillManager.start(
  PROJECT,
  'subagent',
  'Plain task',
  'Do a simple task.',
  'Return the string "ok"'
)
assert.equal(noSkillStart.ok, true, 'no-skill subagent run accepted')
const noSkillRunId = noSkillStart.ok ? noSkillStart.runId : ''
await waitFor(async () => {
  const runs = await noSkillManager.list(PROJECT)
  return runs.some(
    (r) => r.runId === noSkillRunId && (r.status === 'done' || r.status === 'failed')
  )
})
const noSkillTrace = await service.readModuleTrace(PROJECT, noSkillRunId)
assert.ok(noSkillTrace, 'no-skill module trace written')
const noSkillSystemPrompt = noSkillTrace!.entries.find((e) => e.role === 'system')?.content ?? ''
assert.ok(
  !noSkillSystemPrompt.includes('read_skill'),
  'module system prompt omits the skills section when no skills are enabled'
)

console.log('MODULES TESTS PASSED')
