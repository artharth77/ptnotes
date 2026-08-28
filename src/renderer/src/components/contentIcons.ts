import {
  mdiBookOpenVariant,
  mdiFileCodeOutline,
  mdiFileOutline,
  mdiFilePowerpointOutline,
  mdiFileWordOutline,
  mdiImageOutline,
  mdiNoteTextOutline,
  mdiNotebookMultiple,
  mdiViewColumn
} from '@mdi/js'

export const NOTE_LINK_ICON = mdiNoteTextOutline
export const KANBAN_LINK_ICON = mdiViewColumn
export const SKILL_LINK_ICON = mdiBookOpenVariant
export const PLAN_LINK_ICON = mdiNotebookMultiple

export function fileTypeIcon(file: string): string {
  const ext = file.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'docx':
      return mdiFileWordOutline
    case 'pptx':
      return mdiFilePowerpointOutline
    case 'png':
    case 'jpeg':
    case 'jpg':
    case 'gif':
    case 'webp':
      return mdiImageOutline
    case 'svg':
      return mdiFileCodeOutline
    default:
      return mdiFileOutline
  }
}
