export const SKILLS_PREAMBLE =
  "You can load skills (named instruction documents) on demand when a task is relevant. Call the read_skill tool to load a skill's full content before applying it; pass `file` (relative path like FORMAT.md or doc/DOC.md) to load a sibling file referenced from SKILL.md."

export const TASK_LOCATOR_HINT =
  'Task locator: id (uuid) or taskNo (e.g. 1.2) or title. Placement: parent? (id|taskNo|title to nest under) and/or addAfter? (id|taskNo|title to insert after); without parent, new task is sibling of matched addAfter task.'

export const RENDER_HINT =
  'Pure local rendering — NO network/CLI/headless. Charts: {type, data:{labels,datasets}} via chart_preview/render_chart; Diagrams: mermaid (flowchart/sequence/state/class/er/pie/gantt) via diagram_preview/render_diagram; Infographics: @antv templates via list→preview→render; Icons: mdi/<name> (local) or Lucide search/get. Temp <project>/.data/modules/temp/<slug>.[png|svg|json] auto-deleted after deck build.'

export const PROJECT_CONTEXT_PREAMBLE =
  'All project tools target the current project (given in context). To work in another project, ask the user to switch the active project first.'
