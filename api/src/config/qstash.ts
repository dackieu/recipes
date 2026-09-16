import { Client, Receiver } from "@upstash/qstash"

const qstashToken = process.env.QSTASH_TOKEN
const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY

export const qstashClient = qstashToken ? new Client({ token: qstashToken }) : null

export const qstashReceiver =
  currentSigningKey && nextSigningKey
    ? new Receiver({
        currentSigningKey,
        nextSigningKey,
      })
    : null

export const QSTASH_CONFIG = {
  queueName: "email-queue",
  defaultRetries: 3,
  defaultDelay: 0,
  getWebhookUrl: () => {
    const baseUrl = process.env.API_BASE_URL || "http://localhost:3000"
    return `${baseUrl.replace(/\/$/, "")}/api/webhooks/qstash/mail`
  },
}
