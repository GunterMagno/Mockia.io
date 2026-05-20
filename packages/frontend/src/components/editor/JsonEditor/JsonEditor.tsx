import React, { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'

export interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

import styles from './JsonEditor.module.scss'

export const JsonEditor: React.FC<JsonEditorProps> = ({ value, onChange, readOnly }) => {
  const [isSmallScreen, setIsSmallScreen] = useState(false)

  useEffect(() => {
    // Check screen size on client mount and resize
    const checkScreenSize = () => {
      setIsSmallScreen(window.innerWidth < 1450)
    }
    
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  return (
    <section className={styles.editorWrapper}>
      <Editor
        height={isSmallScreen ? 450 : '100%'}
        defaultLanguage="json"
        value={value}
        theme="vs-dark" // vs-dark matches standard dark mode better, or "light" if preferred
        options={{
          readOnly,
          minimap: { enabled: false },
          formatOnPaste: true,
          formatOnType: true,
          scrollBeyondLastLine: false,
          tabSize: 2,
          automaticLayout: true
        }}
        onMount={(editor) => {
          // Force layout calculations once the Monaco editor is fully mounted
          setTimeout(() => {
            editor.layout()
          }, 100)
          setTimeout(() => {
            editor.layout()
          }, 500)
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
