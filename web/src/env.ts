import { z } from 'zod'

const isBuildPhase =
  process.env.npm_lifecycle_event === 'build' ||
  process.env.NEXT_PHASE === 'phase-production-build'
const isProductionRuntime = process.env.NODE_ENV === 'production' && !isBuildPhase

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: isProductionRuntime
    ? z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required in production runtime')
    : z.string().min(1).optional(),
  CRON_SECRET: isProductionRuntime
    ? z.string().min(1, 'CRON_SECRET is required in production runtime')
    : z.string().min(1).optional(),
})

const parseEnv = () => {
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
  })

  const skipValidation = !isProductionRuntime && (process.env.SKIP_ENV_VALIDATION === 'true' || isBuildPhase)
  
  if (!parsed.success && !skipValidation) {
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors)
    throw new Error('Invalid environment variables')
  }
  return (parsed.success ? parsed.data : process.env) as unknown as z.infer<typeof envSchema>
}

export const env = parseEnv()
