## Objetivo

Que solo se envíen dos tipos de email de autenticación:
- **Confirmación de email** (signup)
- **Reset de contraseña** (recovery)

El resto (magic link, invite, email change, reauthentication) quedará desactivado a nivel de webhook.

## Cambios

### 1. `src/routes/lovable/email/auth/webhook.ts`
- Dejar en `EMAIL_TEMPLATES` y `EMAIL_SUBJECTS` solo `signup` y `recovery`.
- Quitar los imports de `InviteEmail`, `MagicLinkEmail`, `EmailChangeEmail`, `ReauthenticationEmail`.
- Si llega un `action_type` distinto a esos dos, devolver `200` sin enviar (para no romper el flujo de Supabase) y loguearlo como ignorado.

### 2. Limpieza de plantillas
Borrar los archivos no usados:
- `src/lib/email-templates/magic-link.tsx`
- `src/lib/email-templates/invite.tsx`
- `src/lib/email-templates/email-change.tsx`
- `src/lib/email-templates/reauthentication.tsx`

Se conservan `signup.tsx` y `recovery.tsx` con el branding ya aplicado.

### 3. Preview (`src/routes/lovable/email/auth/preview.ts`)
Actualizar el listado de plantillas disponibles para que solo muestre `signup` y `recovery`, evitando imports rotos.

## Notas

- No se toca la configuración de Supabase Auth: si el usuario nunca pide magic link / invite / cambio de email, esos eventos no se disparan. El filtro en el webhook es una salvaguarda extra.
- La infraestructura de cola y dominio se mantiene igual.
