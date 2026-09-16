import resend from "../config/email"
import { qstashClient, QSTASH_CONFIG } from "../config/qstash"
import { AppError } from "../utils/AppError"
import {
  EmailJobPayload,
  EmailSendOptions,
  EnqueueEmailResult,
} from "../types/email.type"

const DEFAULT_FROM = `"Bếp Phương" <noreply@bepphuong.online>`

/**
 * Executes direct email delivery via Resend.
 * This is called by the QStash webhook worker, or as a direct fallback in dev mode.
 */
export const sendMailDirect = async (payload: EmailJobPayload) => {
  const { to, subject, html, from = DEFAULT_FROM } = payload

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
    })

    if (error) {
      console.error(
        `[${new Date().toISOString()}] [RESEND] ❌ Failed to send email to ${to}:`,
        error
      )
      throw new AppError(`Error sending email: ${error.message}`, 500)
    }

    console.log(
      `[${new Date().toISOString()}] [RESEND] ✅ Email delivered successfully to ${to}. ID: ${data?.id}`
    )
    return data
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [EMAIL] ❌ Error sending email to ${to}:`,
      error
    )
    if (error instanceof AppError) throw error
    throw new AppError(
      `Error sending email: ${error.message || "Failed to send"}`,
      500
    )
  }
}

/**
 * Asynchronously queues an email for delivery via Upstash QStash.
 * If QSTASH_TOKEN is not configured (e.g. local development), it automatically
 * falls back to synchronous direct sending.
 */
export const sendMail = async (
  email: string,
  subject: string,
  html: string,
  options?: EmailSendOptions
): Promise<EnqueueEmailResult> => {
  const from = DEFAULT_FROM
  const retries =
    options?.retries !== undefined
      ? options.retries
      : QSTASH_CONFIG.defaultRetries
  const delay =
    options?.delay !== undefined ? options.delay : QSTASH_CONFIG.defaultDelay

  // If QStash client is available, enqueue to QStash queue
  if (qstashClient) {
    try {
      const webhookUrl = QSTASH_CONFIG.getWebhookUrl()
      const queue = qstashClient.queue({ queueName: QSTASH_CONFIG.queueName })

      const publishResult = await queue.enqueueJSON({
        url: webhookUrl,
        body: {
          to: email,
          subject,
          html,
          from,
        },
        retries,
        delay: delay ? (delay as any) : undefined,
      })

      console.log(
        `[${new Date().toISOString()}] [QSTASH] 📥 Enqueued email job to "${QSTASH_CONFIG.queueName}". MessageId: ${publishResult.messageId} -> ${webhookUrl}`
      )

      return {
        messageId: publishResult.messageId,
        enqueued: true,
      }
    } catch (error: any) {
      console.error(
        `[${new Date().toISOString()}] [QSTASH] ❌ Failed to enqueue email job to QStash:`,
        error
      )
      // Fallback to direct sending if enqueueing fails to ensure delivery
      console.warn("⚠️ [QSTASH] Falling back to direct email sending via Resend...")
      await sendMailDirect({ to: email, subject, html, from })
      return { enqueued: false }
    }
  }

  // Graceful fallback for local development when QStash is not configured
  console.log(
    `[${new Date().toISOString()}] [EMAIL] ℹ️ QStash token not configured. Sending email directly via Resend.`
  )
  await sendMailDirect({ to: email, subject, html, from })
  return { enqueued: false }
}

export default sendMail
