import { cloudEditorVersionSchema } from '#cloud/contract'
import {
  staticEntitlementsFromTOML,
  staticEntitlementsTOMLSchema
} from '#cloud/server/policy/static'
import { parse as parseTOML } from 'smol-toml'
import * as v from 'valibot'

import { parseCloudServerConfig, type CloudServerConfig } from './schema'

export type CloudEnvironment = Readonly<Record<string, string | undefined>>

const DEFAULT_SECRET_NAMES = {
  databaseURL: 'DATABASE_URL',
  authSecret: 'BETTER_AUTH_SECRET',
  googleClientId: 'GOOGLE_CLIENT_ID',
  googleClientSecret: 'GOOGLE_CLIENT_SECRET',
  applePrivateKey: 'APPLE_PRIVATE_KEY',
  s3AccessKeyId: 'S3_ACCESS_KEY_ID',
  s3SecretAccessKey: 'S3_SECRET_ACCESS_KEY',
  s3SessionToken: 'S3_SESSION_TOKEN',
  smtpUser: 'OPENPENCIL_CLOUD_SMTP_USER',
  smtpPassword: 'OPENPENCIL_CLOUD_SMTP_PASSWORD',
  turnstileSecretKey: 'TURNSTILE_SECRET_KEY',
  aiSigningKey: 'OPENPENCIL_CLOUD_AI_SIGNING_KEY',
  internalServiceToken: 'OPENPENCIL_CLOUD_SERVICE_TOKEN'
} as const

const url = v.pipe(v.string(), v.url())
const text = v.pipe(v.string(), v.trim(), v.minLength(1))
const positiveInteger = v.pipe(v.number(), v.integer(), v.minValue(1))
const secretReferenceSchema = v.strictObject({ from_env: text })
const configurableTextSchema = v.union([text, secretReferenceSchema])
const defaultReference = (name: string) => v.optional(secretReferenceSchema, { from_env: name })

const providerSchema = v.strictObject({
  google: v.optional(
    v.strictObject({
      client_id: v.optional(configurableTextSchema, {
        from_env: DEFAULT_SECRET_NAMES.googleClientId
      }),
      client_secret: defaultReference(DEFAULT_SECRET_NAMES.googleClientSecret)
    })
  ),
  apple: v.optional(
    v.strictObject({
      client_id: text,
      team_id: text,
      key_id: text,
      private_key: defaultReference(DEFAULT_SECRET_NAMES.applePrivateKey),
      app_bundle_identifier: v.optional(text)
    })
  )
})

const emailSchema = v.optional(
  v.variant('transport', [
    v.strictObject({ transport: v.literal('none') }),
    v.strictObject({
      transport: v.literal('smtp'),
      from: text,
      smtp: v.strictObject({
        host: text,
        port: positiveInteger,
        secure: v.optional(v.boolean()),
        user: v.optional(secretReferenceSchema, {
          from_env: DEFAULT_SECRET_NAMES.smtpUser
        }),
        password: v.optional(secretReferenceSchema, {
          from_env: DEFAULT_SECRET_NAMES.smtpPassword
        })
      })
    }),
    v.strictObject({ transport: v.literal('cloudflare'), from: text })
  ]),
  { transport: 'none' }
)

/**
 * Every table is strict: a key the schema doesn't know, such as one renamed since, stops startup
 * instead of leaving its setting at a default the operator never chose.
 */
export const cloudDeploymentConfigSchema = v.strictObject({
  schema_version: v.literal(2),
  deployment: v.strictObject({
    mode: v.picklist(['official', 'self-hosted']),
    public_url: url,
    app_url: v.optional(url),
    indexing: v.optional(v.picklist(['allow', 'deny']), 'deny'),
    trusted_origins: v.optional(v.array(url), []),
    // The server's editor works with files on this device without signing in to the server.
    local_editor: v.optional(v.boolean(), true),
    listing: v.optional(v.strictObject({ minimum_editor_version: cloudEditorVersionSchema }))
  }),
  database: v.optional(
    v.strictObject({ url: defaultReference(DEFAULT_SECRET_NAMES.databaseURL) }),
    {
      url: { from_env: DEFAULT_SECRET_NAMES.databaseURL }
    }
  ),
  authentication: v.strictObject({
    secret: defaultReference(DEFAULT_SECRET_NAMES.authSecret),
    enrollment: v.optional(
      v.strictObject({
        mode: v.optional(v.picklist(['open', 'approval', 'closed']), 'open'),
        notification_emails: v.optional(v.array(v.pipe(v.string(), v.email())), [])
      }),
      { mode: 'open', notification_emails: [] }
    ),
    email_password: v.optional(
      v.strictObject({
        enabled: v.optional(v.boolean(), false),
        sign_up: v.optional(v.boolean(), true),
        minimum_password_length: v.optional(
          v.pipe(v.number(), v.integer(), v.minValue(8), v.maxValue(128)),
          8
        ),
        maximum_password_length: v.optional(
          v.pipe(v.number(), v.integer(), v.minValue(15), v.maxValue(128)),
          128
        ),
        verification_link_lifetime_minutes: v.optional(positiveInteger, 60),
        password_reset_link_lifetime_minutes: v.optional(positiveInteger, 60),
        compromised_password_check: v.optional(v.boolean(), false)
      }),
      {
        enabled: false,
        sign_up: true,
        minimum_password_length: 8,
        maximum_password_length: 128,
        verification_link_lifetime_minutes: 60,
        password_reset_link_lifetime_minutes: 60,
        compromised_password_check: false
      }
    ),
    mfa: v.optional(
      v.strictObject({
        required_for_admins: v.optional(v.boolean(), false),
        totp: v.optional(v.boolean(), false),
        recovery_codes: v.optional(v.boolean(), false),
        trusted_device_lifetime_days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 14)
      }),
      {
        required_for_admins: false,
        totp: false,
        recovery_codes: false,
        trusted_device_lifetime_days: 14
      }
    ),
    // Passkeys belong to public_url's host and origin.
    passkeys: v.optional(
      v.strictObject({
        enabled: v.optional(v.boolean(), false),
        rp_name: v.optional(text, 'OpenPencil Cloud')
      }),
      { enabled: false, rp_name: 'OpenPencil Cloud' }
    ),
    captcha: v.optional(
      v.strictObject({
        provider: v.literal('cloudflare-turnstile'),
        site_key: text,
        secret_key: defaultReference(DEFAULT_SECRET_NAMES.turnstileSecretKey),
        allowed_hostnames: v.optional(v.array(text), [])
      })
    ),
    trusted_proxies: v.optional(
      v.strictObject({
        headers: v.optional(v.array(text), []),
        addresses: v.optional(v.array(text), [])
      }),
      { headers: [], addresses: [] }
    ),
    providers: v.optional(providerSchema, {})
  }),
  object_storage: v.strictObject({
    endpoint: url,
    region: text,
    bucket: text,
    credentials: v.optional(
      v.strictObject({
        access_key_id: defaultReference(DEFAULT_SECRET_NAMES.s3AccessKeyId),
        secret_access_key: defaultReference(DEFAULT_SECRET_NAMES.s3SecretAccessKey),
        session_token: v.optional(secretReferenceSchema, {
          from_env: DEFAULT_SECRET_NAMES.s3SessionToken
        })
      }),
      {
        access_key_id: { from_env: DEFAULT_SECRET_NAMES.s3AccessKeyId },
        secret_access_key: { from_env: DEFAULT_SECRET_NAMES.s3SecretAccessKey }
      }
    ),
    force_path_style: v.optional(v.boolean(), true),
    checksum_verification: v.optional(v.picklist(['native', 'metadata']), 'native'),
    server_side_encryption: v.optional(v.picklist(['AES256', 'aws:kms'])),
    kms_key_id: v.optional(text),
    maximum_upload_bytes: v.optional(positiveInteger)
  }),
  collaboration: v.optional(
    v.strictObject({
      relay_url: v.optional(url),
      maximum_message_bytes: v.optional(positiveInteger),
      maximum_connections_per_room: v.optional(positiveInteger)
    }),
    {}
  ),
  documents: v.optional(
    v.strictObject({
      retention_days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 30)
    }),
    { retention_days: 30 }
  ),
  email: emailSchema,
  workers: v.optional(
    v.strictObject({
      email: v.optional(
        v.strictObject({
          batch_size: v.optional(positiveInteger, 50),
          interval_ms: v.optional(positiveInteger, 30_000),
          lease_ms: v.optional(positiveInteger, 300_000),
          maximum_attempts: v.optional(positiveInteger, 5)
        }),
        { batch_size: 50, interval_ms: 30_000, lease_ms: 300_000, maximum_attempts: 5 }
      ),
      cleanup: v.optional(
        v.strictObject({
          enabled: v.optional(v.boolean(), true),
          batch_size: v.optional(positiveInteger, 100),
          interval_ms: v.optional(positiveInteger, 60_000),
          lease_ms: v.optional(positiveInteger, 300_000)
        }),
        { enabled: true, batch_size: 100, interval_ms: 60_000, lease_ms: 300_000 }
      )
    })
  ),
  entitlements: v.optional(
    v.variant('source', [
      v.strictObject({ source: v.literal('static'), ...staticEntitlementsTOMLSchema.entries }),
      v.strictObject({ source: v.literal('database') })
    ])
  ),
  ai: v.optional(
    v.strictObject({
      endpoint: url,
      signing_key: defaultReference(DEFAULT_SECRET_NAMES.aiSigningKey),
      token_lifetime_minutes: v.optional(
        v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60)),
        10
      )
    })
  ),
  billing: v.optional(v.strictObject({ portal_url: url })),
  internal_api: v.optional(
    v.strictObject({ service_token: defaultReference(DEFAULT_SECRET_NAMES.internalServiceToken) })
  )
})

export type CloudDeploymentConfig = v.InferOutput<typeof cloudDeploymentConfigSchema>
/** Deployment configuration as an operator writes it, before defaults are applied. */
export type CloudDeploymentInput = v.InferInput<typeof cloudDeploymentConfigSchema>
export type CloudSecretReference = v.InferOutput<typeof secretReferenceSchema>

export function parseCloudDeploymentSource(source: string): CloudDeploymentConfig {
  return v.parse(cloudDeploymentConfigSchema, parseTOML(source))
}

function requiredSecret(environment: CloudEnvironment, reference: CloudSecretReference): string {
  const value = environment[reference.from_env]
  if (!value) throw new Error(`Required secret binding is unavailable: ${reference.from_env}`)
  return value
}

function configuredText(
  environment: CloudEnvironment,
  value: string | CloudSecretReference
): string {
  return typeof value === 'string' ? value : requiredSecret(environment, value)
}

function optionalSecret(
  environment: CloudEnvironment,
  reference?: CloudSecretReference
): string | undefined {
  return reference ? environment[reference.from_env] : undefined
}

function staticEntitlements(config: CloudDeploymentConfig) {
  if (config.entitlements?.source !== 'static') return undefined
  return staticEntitlementsFromTOML(config.entitlements)
}

function emailConfig(config: CloudDeploymentConfig, environment: CloudEnvironment) {
  if (config.email.transport === 'none') return { emailTransport: 'none' as const }
  if (config.email.transport === 'cloudflare') {
    return { emailTransport: 'cloudflare' as const, emailFrom: config.email.from }
  }
  return {
    emailTransport: 'smtp' as const,
    emailFrom: config.email.from,
    smtpHost: config.email.smtp.host,
    smtpPort: config.email.smtp.port,
    smtpSecure: config.email.smtp.secure,
    smtpUser: optionalSecret(environment, config.email.smtp.user),
    smtpPassword: optionalSecret(environment, config.email.smtp.password)
  }
}

function authenticationConfig(config: CloudDeploymentConfig, environment: CloudEnvironment) {
  const google = config.authentication.providers.google
  const apple = config.authentication.providers.apple
  return {
    googleClientId: google ? configuredText(environment, google.client_id) : undefined,
    googleClientSecret: google ? requiredSecret(environment, google.client_secret) : undefined,
    appleClientId: apple?.client_id,
    appleTeamId: apple?.team_id,
    appleKeyId: apple?.key_id,
    applePrivateKey: apple ? requiredSecret(environment, apple.private_key) : undefined,
    appleAppBundleIdentifier: apple?.app_bundle_identifier
  }
}

function workerConfig(config: CloudDeploymentConfig) {
  const email = config.workers?.email
  const cleanup = config.workers?.cleanup
  return {
    emailBatchSize: email?.batch_size,
    emailIntervalMs: email?.interval_ms,
    emailLeaseDurationMs: email?.lease_ms,
    emailMaximumAttempts: email?.maximum_attempts,
    cleanupEnabled: cleanup?.enabled,
    cleanupBatchSize: cleanup?.batch_size,
    cleanupIntervalMs: cleanup?.interval_ms,
    cleanupLeaseDurationMs: cleanup?.lease_ms,
    documentRetentionMs: config.documents.retention_days * 86_400_000
  }
}

function serviceConfig(config: CloudDeploymentConfig, environment: CloudEnvironment) {
  return {
    aiEndpoint: config.ai?.endpoint,
    aiSigningKey: config.ai ? requiredSecret(environment, config.ai.signing_key) : undefined,
    aiTokenLifetimeSeconds: config.ai ? config.ai.token_lifetime_minutes * 60 : undefined,
    billingPortalURL: config.billing?.portal_url,
    internalServiceToken: config.internal_api
      ? requiredSecret(environment, config.internal_api.service_token)
      : undefined
  }
}

/** Hard limits, whatever a plan allows; each lives in the section it limits. */
function technicalLimits(config: CloudDeploymentConfig) {
  return {
    maximumUploadBytes: config.object_storage.maximum_upload_bytes,
    maximumCollaborationMessageBytes: config.collaboration.maximum_message_bytes,
    maximumConnectionsPerRoom: config.collaboration.maximum_connections_per_room
  }
}

export function parseCloudDeploymentConfig(
  input: unknown,
  environment: CloudEnvironment
): CloudServerConfig {
  const config = v.parse(cloudDeploymentConfigSchema, input)
  return parseCloudServerConfig({
    deployment: config.deployment.mode,
    publicURL: config.deployment.public_url,
    appURL: config.deployment.app_url,
    indexingPolicy: config.deployment.indexing,
    trustedOrigins: config.deployment.trusted_origins,
    localEditor: config.deployment.local_editor,
    listingMinimumEditorVersion: config.deployment.listing?.minimum_editor_version,
    databaseURL: requiredSecret(environment, config.database.url),
    authSecret: requiredSecret(environment, config.authentication.secret),
    enrollmentMode: config.authentication.enrollment.mode,
    enrollmentAdminNotificationEmails: config.authentication.enrollment.notification_emails,
    emailPasswordEnabled: config.authentication.email_password.enabled,
    emailPasswordSignUpEnabled: config.authentication.email_password.sign_up,
    emailPasswordMinimumLength: config.authentication.email_password.minimum_password_length,
    emailPasswordMaximumLength: config.authentication.email_password.maximum_password_length,
    emailVerificationExpiresIn:
      config.authentication.email_password.verification_link_lifetime_minutes * 60,
    passwordResetExpiresIn:
      config.authentication.email_password.password_reset_link_lifetime_minutes * 60,
    compromisedPasswordCheck: config.authentication.email_password.compromised_password_check,
    deploymentAdminMFARequired: config.authentication.mfa.required_for_admins,
    totpEnabled: config.authentication.mfa.totp,
    recoveryCodesEnabled: config.authentication.mfa.recovery_codes,
    mfaTrustedDeviceDays: config.authentication.mfa.trusted_device_lifetime_days,
    passkeysEnabled: config.authentication.passkeys.enabled,
    passkeyRPName: config.authentication.passkeys.rp_name,
    captchaProvider: config.authentication.captcha?.provider,
    captchaSiteKey: config.authentication.captcha?.site_key,
    captchaSecretKey: config.authentication.captcha
      ? requiredSecret(environment, config.authentication.captcha.secret_key)
      : undefined,
    captchaAllowedHostnames: config.authentication.captcha?.allowed_hostnames,
    authTrustedIPHeaders: config.authentication.trusted_proxies.headers,
    authTrustedProxies: config.authentication.trusted_proxies.addresses,
    ...authenticationConfig(config, environment),
    s3Endpoint: config.object_storage.endpoint,
    s3Region: config.object_storage.region,
    s3Bucket: config.object_storage.bucket,
    s3AccessKeyId: requiredSecret(environment, config.object_storage.credentials.access_key_id),
    s3SecretAccessKey: requiredSecret(
      environment,
      config.object_storage.credentials.secret_access_key
    ),
    s3SessionToken: environment[config.object_storage.credentials.session_token.from_env],
    s3ForcePathStyle: config.object_storage.force_path_style,
    s3ChecksumVerification: config.object_storage.checksum_verification,
    s3ServerSideEncryption: config.object_storage.server_side_encryption,
    s3KmsKeyId: config.object_storage.kms_key_id,
    relayURL: config.collaboration.relay_url,
    staticEntitlements: staticEntitlements(config),
    ...emailConfig(config, environment),
    ...workerConfig(config),
    ...serviceConfig(config, environment),
    technicalLimits: technicalLimits(config)
  })
}

export function parseCloudDeploymentTOML(
  source: string,
  environment: CloudEnvironment
): CloudServerConfig {
  return parseCloudDeploymentConfig(parseCloudDeploymentSource(source), environment)
}
