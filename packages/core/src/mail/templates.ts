/** Escapes text for HTML. Every value put into an email's HTML goes through this. */
export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c)

/** A plain, accessible layout for Parley's own emails: one message and one button. */
const layout = (input: {
  readonly heading: string
  readonly body: string
  readonly action: string
  readonly link: string
  readonly footer: string
}) =>
  `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:10px;padding:28px">
<tr><td style="font-size:17px;font-weight:600;padding-bottom:10px">${escapeHtml(input.heading)}</td></tr>
<tr><td style="font-size:14px;line-height:21px;color:#444;padding-bottom:20px">${escapeHtml(input.body)}</td></tr>
<tr><td><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#222;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">${escapeHtml(input.action)}</a></td></tr>
<tr><td style="font-size:12px;line-height:18px;color:#888;padding-top:20px">${escapeHtml(input.footer)}</td></tr>
</table></td></tr></table></body></html>`

export const renderInvitation = (input: {
  readonly inviterName: string
  readonly teamName: string
  readonly link: string
  readonly validDays: number
}) => {
  const heading = `Join ${input.teamName} on Parley`
  const body = `${input.inviterName} invited you to ${input.teamName}, where your team keeps its contacts and companies.`
  const footer = `This invitation works for ${input.validDays} days. If you weren't expecting it, you can ignore this email.`
  return {
    subject: `${input.inviterName} invited you to ${input.teamName} on Parley`,
    html: layout({ heading, body, action: "Accept invitation", link: input.link, footer }),
    text: `${heading}\n\n${body}\n\nAccept the invitation: ${input.link}\n\n${footer}\n`,
  }
}
