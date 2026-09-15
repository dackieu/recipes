import resend from "../config/email"
import { AppError } from "../utils/AppError"

const sendMail = async (email: string, subject: string, html: string) => {
  const from = `"Bếp Phương" <noreply@bepphuong.online>`

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [email],
      subject,
      html,
    })

    if (error) {
      console.error(
        `[${new Date().toISOString()}] [RESEND] ❌ Failed to send email to ${email}:`,
        error
      )
      throw new AppError(`Error sending email: ${error.message}`, 500)
    }

    return data
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [EMAIL] ❌ Error sending email to ${email}:`,
      error
    )
    if (error instanceof AppError) throw error
    throw new AppError(`Error sending email: ${error.message || "Failed to send"}`, 500)
  }
}

export default sendMail
