import React from 'react'
import Editor from '@monaco-editor/react'

export interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

import styles from './JsonEditor.module.scss'

export const JsonEditor: React.FC<JsonEditorProps> = ({ value, onChange, readOnly }) => {
  return (
    <section className={styles.editorWrapper}>
      <Editor
        height="100%"
        defaultLanguage="json"
        value={value}
        theme="vs-dark" // vs-dark matches standard dark mode better, or "light" if preferred
        options={{
          readOnly,
          minimap: { enabled: false },
          formatOnPaste: true,
          formatOnType: true,
          scrollBeyondLastLine: false,
          tabSize: 2
        }}
        onChange={(val) => {
          if (val !== undefined) {
            onChange(val)
          }
        }}
      />
    </section>
  )
}

export default JsonEditor
