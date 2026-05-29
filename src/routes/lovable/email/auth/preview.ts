import * as React from 'react'
import { render } from '@react-email/components'
import { createFileRoute } from '@tanstack/react-router'
import { SignupEmail } from '@/lib/email-templates/signup'
import { RecoveryEmail } from '@/lib/email-templates/recovery'

const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  recovery: RecoveryEmail,
}

const SITE_NAME = "LaKitchen"
const ROOT_DOMAIN = "lakitchenapp.com"

const SAMPLE_PROJECT_URL = `https://${ROOT_DOMAIN}`
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
}

export const Route = createFileRoute("/lovable/email/auth/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY

        if (!apiKey) {
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }

        const authHeader = request.headers.get('Authorization')
        if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let type: string
        try {
          const body = await request.json()
          type = body.type
        } catch {
          return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 })
        }

        const EmailTemplate = EMAIL_TEMPLATES[type]
        if (!EmailTemplate) {
          return Response.json({ error: `Unknown email type: ${type}` }, { status: 400 })
        }

        const sampleData = SAMPLE_DATA[type] || {}
        const html = await render(React.createElement(EmailTemplate, sampleData))

        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
})
