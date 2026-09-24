type EditorSelectAllHandler = () => boolean

let handler: EditorSelectAllHandler | null = null

export function setEditorSelectAllHandler(fn: EditorSelectAllHandler | null): void {
  handler = fn
}

export function runEditorSelectAll(): boolean {
  return handler ? handler() : false
}
