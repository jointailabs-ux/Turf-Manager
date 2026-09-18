import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sqlPath = path.resolve(__dirname, '../supabase/migrations/20260907020000_phase8_audit_append_only.sql')
const rawSql = fs.readFileSync(sqlPath, 'utf-8')
const sql = `
DROP TRIGGER IF EXISTS prevent_audit_update ON public.audit_logs;
DROP TRIGGER IF EXISTS prevent_audit_delete ON public.audit_logs;
${rawSql}
`


const password = encodeURIComponent('TurfManager@2026')
const projectRef = 'blticunftrrodvxaqnbd'

// Supabase Connection string candidates
const regions = [
  'ap-south-1',
  'us-east-1',
  'us-west-1',
  'eu-west-1',
  'eu-central-1',
  'ap-southeast-1',
  'ap-northeast-1',
  'sa-east-1',
  'ca-central-1'
]

async function run() {
  let connectedClient = null

  // Try direct connection or poolers across regions
  const connectionConfigs = [
    {
      name: `Direct session pooler (aws-0)`,
      connectionString: `postgresql://postgres.${projectRef}:${password}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
    },
    ...regions.map(r => ({
      name: `Pooler ${r}`,
      connectionString: `postgresql://postgres.${projectRef}:${password}@aws-0-${r}.pooler.supabase.com:6543/postgres`
    }))
  ]


  for (const config of connectionConfigs) {
    console.log(`Trying connection: ${config.name}...`)
    const client = new pg.Client({
      connectionString: config.connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000
    })
    try {
      await client.connect()
      console.log(`SUCCESS connected via ${config.name}!`)
      connectedClient = client
      break
    } catch (err) {
      console.log(`Failed ${config.name}: ${err.message}`)
      await client.end().catch(() => {})
    }
  }

  if (!connectedClient) {
    console.error('Could not connect to Supabase PostgreSQL database using pooler hostnames.')
    process.exit(1)
  }

  console.log('Executing combined migrations SQL...')
  try {
    await connectedClient.query(sql)
    console.log('MIGRATIONS APPLIED SUCCESSFULLY!')
  } catch (err) {
    console.error('Error applying migrations SQL:', err)
  } finally {
    await connectedClient.end()
  }
}

run()
