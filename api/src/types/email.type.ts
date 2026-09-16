export interface EmailJobPayload {
  to: string
  subject: string
  html: string
  from?: string
}

export interface EmailSendOptions {
  /**
   * Number of retries if webhook or email sending fails
   * Defaults to QSTASH_EMAIL_RETRIES or 3
   */
  retries?: number

  /**
   * Delay before sending (e.g. 10 for 10 seconds, or "10s", "1m", "15m", "1h")
   * Defaults to QSTASH_EMAIL_DELAY or 0
   */
  delay?: string | number
}

export interface EnqueueEmailResult {
  messageId?: string
  enqueued: boolean
}
