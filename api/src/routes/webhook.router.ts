import { Router } from "express"
import { verifyQStashSignature } from "../middlewares/qstash.middleware"
import { validateBody } from "../middlewares/validate"
import { EmailWebhookPayloadSchema } from "../schemas/webhook.schema"
import { webhookController } from "../controllers/webhook.controller"

const router = Router()

/**
 * POST /api/webhooks/qstash/mail
 * Receives queued email job from Upstash QStash, verifies HMAC signature,
 * validates payload, and delivers the email via Resend.
 */
router.post(
  "/qstash/mail",
  verifyQStashSignature,
  validateBody(EmailWebhookPayloadSchema),
  webhookController.handleQStashMailWebhook
)

export default router
