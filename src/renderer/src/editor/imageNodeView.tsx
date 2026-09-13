/* eslint-disable react-refresh/only-export-components -- the file exports one TipTap extension built around its (non-exported) node view component */
import { useState } from 'react'
import { mdiDeleteOutline, mdiFullscreen, mdiKeyboardReturn } from '@mdi/js'
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { MdiIcon } from '../components/MdiIcon'
import { ImageViewer } from '../components/ImageViewer'
import { useAppStore } from '../store/useAppStore'

/** Path of the active project, or null when no project is open. */
export function useActiveProjectPath(): string | null {
  return useAppStore((s) => s.projects.find((p) => p.name === s.activeProject)?.path ?? null)
}

/** Build a `ptfile://` URL for an absolute local file path. */
export function ptFileUrl(absPath: string): string {
  if (/^[a-zA-Z]:/.test(absPath)) return `ptfile://local/${absPath.replace(/\\/g, '/')}`
  return `ptfile://local${absPath}`
}

/**
 * Resolve a markdown image src to a URL the renderer can load. Absolute local
 * paths go through the `ptfile://` protocol; relative paths (e.g. gallery
 * images) resolve against `<project>/notes/`.
 */
export function resolveImageSrc(src: string, projectPath: string | null): string {
  if (!src) return src
  if (/^(https?|data|ptfile):/i.test(src)) return src
  if (/^[a-zA-Z]:/.test(src)) return `ptfile://local/${src.replace(/\\/g, '/')}`
  if (src.startsWith('/')) return `ptfile://local${src}`
  if (projectPath) {
    const base = `${projectPath.replace(/\\/g, '/').replace(/\/$/, '')}/notes`
    return `ptfile://local/${base}/${src.replace(/^\.\//, '')}`
  }
  return src
}

/** Insert an empty paragraph right after this image and move the caret into it. */
function insertLineAfter(props: ReactNodeViewProps): void {
  const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
  if (typeof pos !== 'number') return
  const { state, view } = props.editor
  const end = pos + props.node.nodeSize
  const paragraph = state.schema.nodes.paragraph
  if (!paragraph) return
  const tr = state.tr.insert(end, paragraph.create())
  tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

/** Remove this image node from the document. */
function deleteImage(props: ReactNodeViewProps): void {
  const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
  if (typeof pos !== 'number') return
  props.editor.view.dispatch(props.editor.state.tr.delete(pos, pos + props.node.nodeSize))
  props.editor.view.focus()
}

function ImageView(props: ReactNodeViewProps): React.JSX.Element {
  const src = (props.node.attrs.src as string) ?? ''
  const alt = (props.node.attrs.alt as string) ?? ''
  const projectPath = useActiveProjectPath()
  const [lightbox, setLightbox] = useState(false)
  const resolved = resolveImageSrc(src, projectPath)
  return (
    <NodeViewWrapper className="editor-image" as="div">
      <div
        className={`editor-image-frame${props.selected ? ' selected' : ''}`}
        contentEditable={false}
      >
        <img src={resolved} alt={alt} title={alt || undefined} draggable={false} />
        <div
          className="editor-image-actions"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="editor-image-group">
            <button
              type="button"
              className="editor-image-btn"
              title="New line after image"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertLineAfter(props)}
            >
              <MdiIcon path={mdiKeyboardReturn} size={16} />
            </button>
            <button
              type="button"
              className="editor-image-btn"
              title="Delete image"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => deleteImage(props)}
            >
              <MdiIcon path={mdiDeleteOutline} size={16} />
            </button>
          </div>
          <div className="editor-image-group">
            <button
              type="button"
              className="editor-image-btn"
              title="Show enlarged image (Esc to exit)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setLightbox(true)}
            >
              <MdiIcon path={mdiFullscreen} size={16} />
            </button>
          </div>
        </div>
      </div>
      {lightbox && (
        <ImageViewer src={resolved} alt={alt || 'Image'} onClose={() => setLightbox(false)} />
      )}
    </NodeViewWrapper>
  )
}

/** Image node with the hover zoom-button node view. Used by the markdown editor. */
export const EditorImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  }
})
