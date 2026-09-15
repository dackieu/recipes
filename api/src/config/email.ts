import { Resend } from "resend"

const apiKey = process.env.RESEND_EMAIL_API_KEY

export const resend = new Resend(apiKey)

export default resend
