import React, { useState } from 'react'
import { sendAiFeedback, type AiVerdict } from '../../../services/aiService'
import { useI18n } from '../../../i18n/I18nProvider'
import styles from './AiFeedback.module.scss'

type Props = {
  /** Id returned with the generation. Without it (an older server) there is nothing to rate and nothing is rendered. */
  generationId?: string
}

/**
 * "Was this useful?" thumbs up / down under an AI result. The vote is sent at once; the user can change it (the server
 * keeps the latest one per generation). No correction UI: the API accepts one, this control does not offer it.
 */
const AiFeedback: React.FC<Props> = ({ generationId }) => {
  const { t } = useI18n()
  const [voted, setVoted] = useState<AiVerdict | null>(null)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!generationId) return null

  const vote = async (verdict: AiVerdict) => {
    if (sending || verdict === voted) return
    setSending(true)
    setFailed(false)
    try {
      await sendAiFeedback(generationId, verdict)
      setVoted(verdict)
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.feedback} role="group" aria-label={t('aiFeedback.group')} data-ai-feedback>
      <span className={styles.question}>{t('aiFeedback.question')}</span>
      <span className={styles.buttons}>
        <button
          type="button"
          className={styles.vote}
          aria-pressed={voted === 'good'}
          aria-label={t('aiFeedback.useful')}
          title={t('aiFeedback.useful')}
          disabled={sending}
          onClick={() => vote('good')}
          data-ai-feedback-good
        >
          <span aria-hidden="true">👍</span>
        </button>
        <button
          type="button"
          className={styles.vote}
          aria-pressed={voted === 'bad'}
          aria-label={t('aiFeedback.notUseful')}
          title={t('aiFeedback.notUseful')}
          disabled={sending}
          onClick={() => vote('bad')}
          data-ai-feedback-bad
        >
          <span aria-hidden="true">👎</span>
        </button>
      </span>
      {/* The live regions exist before their content, so screen readers announce the change */}
      <span className={styles.thanks} role="status" aria-live="polite">
        {voted ? t('aiFeedback.thanks') : ''}
      </span>
      <span className={styles.error} role="alert" aria-live="assertive">
        {failed ? t('aiFeedback.failed') : ''}
      </span>
    </div>
  )
}

export default AiFeedback
