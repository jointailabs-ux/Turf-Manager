'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const AuthSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export async function login(formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = AuthSchema.safeParse(data)

  if (!parsed.success) {
    redirect('/login?error=Invalid inputs')
  }

  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = AuthSchema.safeParse(data)

  if (!parsed.success) {
    redirect('/login?error=Invalid inputs')
  }

  const { error } = await supabase.auth.signUp(parsed.data)

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')
  // We direct them to dashboard or verification page depending on Supabase setting
  redirect('/dashboard')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
