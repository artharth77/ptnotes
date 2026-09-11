export interface SupportedLang {
  key: string
  label: string
}

export const SUPPORTED_LANGUAGES: SupportedLang[] = [
  { key: 'text', label: 'Plain Text' },
  { key: 'javascript', label: 'JavaScript' },
  { key: 'typescript', label: 'TypeScript' },
  { key: 'jsx', label: 'JSX' },
  { key: 'tsx', label: 'TSX' },
  { key: 'python', label: 'Python' },
  { key: 'bash', label: 'Bash' },
  { key: 'shell', label: 'Shell' },
  { key: 'sh', label: 'sh' },
  { key: 'zsh', label: 'Zsh' },
  { key: 'sql', label: 'SQL' },
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
  { key: 'scss', label: 'SCSS' },
  { key: 'less', label: 'Less' },
  { key: 'json', label: 'JSON' },
  { key: 'yaml', label: 'YAML' },
  { key: 'yml', label: 'YML' },
  { key: 'xml', label: 'XML' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'md', label: 'MD' },
  { key: 'rust', label: 'Rust' },
  { key: 'go', label: 'Go' },
  { key: 'java', label: 'Java' },
  { key: 'c', label: 'C' },
  { key: 'cpp', label: 'C++' },
  { key: 'ruby', label: 'Ruby' },
  { key: 'php', label: 'PHP' },
  { key: 'dockerfile', label: 'Dockerfile' },
  { key: 'toml', label: 'TOML' },
  { key: 'ini', label: 'INI' },
  { key: 'diff', label: 'Diff' },
  { key: 'mermaid', label: 'Mermaid' }
]
