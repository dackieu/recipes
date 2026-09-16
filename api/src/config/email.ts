import { Resend } from "resend"

const apiKey = process.env.RESEND_EMAIL_API_KEY

export const resend = new Resend(apiKey || "re_dummy_key_to_prevent_startup_crash")

export default resend
